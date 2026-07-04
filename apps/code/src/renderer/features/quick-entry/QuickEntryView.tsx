import "./quick-entry-glass.css";
import type { SessionConfigSelectGroup } from "@agentclientprotocol/sdk";
import { ArrowUp, Check, Cpu, Gauge } from "@phosphor-icons/react";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { formatHotkey } from "@posthog/ui/features/command/keyboard-shortcuts";
import { useGitQueries } from "@posthog/ui/features/git-interaction/useGitQueries";
import { AttachmentMenu } from "@posthog/ui/features/message-editor/components/AttachmentMenu";
import { AttachmentsBar } from "@posthog/ui/features/message-editor/components/AttachmentsBar";
import { contentToXml } from "@posthog/ui/features/message-editor/content";
import { useDraftStore } from "@posthog/ui/features/message-editor/draftStore";
import { useTaskInputHistoryStore } from "@posthog/ui/features/message-editor/taskInputHistoryStore";
import { TiptapEditorContent } from "@posthog/ui/features/message-editor/tiptap/editorSurface";
import { useTiptapEditor } from "@posthog/ui/features/message-editor/tiptap/useTiptapEditor";
import { getModeStyle } from "@posthog/ui/features/sessions/modeStyles";
import {
  flattenSelectOptions,
  getCurrentModeFromConfigOptions,
} from "@posthog/ui/features/sessions/sessionStore";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { usePreviewConfig } from "@posthog/ui/features/task-detail/hooks/usePreviewConfig";
import { acceleratorToHotkey } from "@posthog/ui/utils/accelerator";
import { hasOpenOverlay } from "@posthog/ui/utils/overlay";
import { Text } from "@radix-ui/themes";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { useSubscription } from "@trpc/tanstack-react-query";
import { logger } from "@utils/logger";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import {
  AdapterSwitchItem,
  BranchChip,
  GlassSelect,
  Keycap,
  RepoChip,
} from "./QuickEntryGlassControls";

const log = logger.scope("quick-entry-view");
const SESSION_ID = "quick-entry";
const CONFIRMATION_MS = 1200;

// Accent follows mode: Plan is amber, everything agentic is orange.
const PLAN_ACCENT: Record<string, string> = {
  "--qe-accent": "var(--amber-9, #ffc53d)",
  "--qe-accent-text": "var(--amber-11, #ffca16)",
  "--qe-on-accent": "#16120c",
};
const AGENT_ACCENT: Record<string, string> = {
  "--qe-accent": "var(--orange-9, #f76b15)",
  "--qe-accent-text": "var(--orange-11, #ffa057)",
  "--qe-on-accent": "#17120e",
};

function hideWindow(): void {
  trpcClient.quickEntry.hide.mutate().catch((err) => {
    log.warn("Failed to hide quick entry window", { err });
  });
}

export function QuickEntryView() {
  const trpcReact = useTRPC();
  const [selectedDirectory, setSelectedDirectory] = useState<string>("");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorIsEmpty, setEditorIsEmpty] = useState(true);
  const [editorFocused, setEditorFocused] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);

  const { currentBranch, defaultBranch } = useGitQueries(selectedDirectory);

  const isAuthenticated = useAuthStateValue(
    (state) => state.status === "authenticated",
  );

  const {
    lastUsedAdapter,
    setLastUsedAdapter,
    lastUsedWorkspaceMode,
    defaultInitialTaskMode,
    lastUsedInitialTaskMode,
    setLastUsedReasoningEffort,
    quickEntryShortcut,
  } = useSettingsStore();

  const adapter = lastUsedAdapter ?? "claude";
  // Cloud isn't supported from quick entry (no cloud repo picker here).
  const effectiveWorkspaceMode: "worktree" | "local" =
    lastUsedWorkspaceMode === "cloud"
      ? "worktree"
      : (lastUsedWorkspaceMode as "worktree" | "local");

  const {
    modeOption,
    modelOption,
    thoughtOption,
    isLoading: isPreviewLoading,
    setConfigOption,
  } = usePreviewConfig(adapter);

  const busy = isSubmitting || confirming;

  const {
    editor,
    focus,
    clear,
    getText,
    getContent,
    insertChip,
    removeChipById,
    attachments,
    addAttachment,
    removeAttachment,
  } = useTiptapEditor({
    sessionId: SESSION_ID,
    placeholder: "What do you want to ship?",
    disabled: busy,
    autoFocus: true,
    clearOnSubmit: false,
    context: { repoPath: selectedDirectory || undefined },
    capabilities: { commands: true, bashMode: false },
    getPromptHistory: useCallback(
      () => useTaskInputHistoryStore.getState().entries.map((e) => e.text),
      [],
    ),
    onSubmit: () => {
      void handleSubmitRef.current?.();
    },
    onEmptyChange: setEditorIsEmpty,
    onFocus: () => setEditorFocused(true),
    onBlur: () => setEditorFocused(false),
  });

  // Seed default folder once from the most-recently-accessed repository.
  useEffect(() => {
    if (selectedDirectory) return;
    let cancelled = false;
    trpcClient.folders.getMostRecentlyAccessedRepository
      .query()
      .then((repo) => {
        if (cancelled || !repo) return;
        setSelectedDirectory(repo.path);
      })
      .catch(() => {
        // ignore — user can still pick manually
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDirectory]);

  // Populate command list for @ file mentions + / skills.
  useEffect(() => {
    let cancelled = false;
    trpcClient.skills.list
      .query()
      .then((skills) => {
        if (cancelled) return;
        useDraftStore.getState().actions.setCommands(
          SESSION_ID,
          skills.map((s) => ({
            name: s.name,
            description: s.description,
          })),
        );
      })
      .catch((err) => {
        log.warn("Failed to load skills for quick entry", { err });
      });
    return () => {
      cancelled = true;
      useDraftStore.getState().actions.clearCommands(SESSION_ID);
    };
  }, []);

  useSubscription(
    trpcReact.quickEntry.onFocusInput.subscriptionOptions(undefined, {
      onData: () => {
        focus();
      },
    }),
  );

  useSubscription(
    trpcReact.quickEntry.onHide.subscriptionOptions(undefined, {
      onData: () => {
        if (confirmTimerRef.current !== null) {
          window.clearTimeout(confirmTimerRef.current);
          confirmTimerRef.current = null;
        }
        clear();
        setConfirming(false);
        setError(null);
      },
    }),
  );

  // Changing repo resets branch to that repo's default (defaultBranch loads
  // async; null means "use default once known").
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only reset when repo changes
  useEffect(() => {
    setSelectedBranch(null);
  }, [selectedDirectory]);

  useHotkeys(
    "escape",
    () => {
      // Let an open popover (@-menu, pickers) consume Esc before the overlay.
      if (hasOpenOverlay()) return;
      hideWindow();
    },
    {
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
  );

  const handleModeChange = useCallback(
    (value: string) => {
      if (modeOption) setConfigOption(modeOption.id, value);
    },
    [modeOption, setConfigOption],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      if (modelOption) setConfigOption(modelOption.id, value);
    },
    [modelOption, setConfigOption],
  );

  const handleThoughtChange = useCallback(
    (value: string) => {
      if (thoughtOption) {
        setConfigOption(thoughtOption.id, value);
        setLastUsedReasoningEffort(value);
      }
    },
    [thoughtOption, setConfigOption, setLastUsedReasoningEffort],
  );

  const canSubmit = !!selectedDirectory && !editorIsEmpty && !busy;

  const handleSubmit = useCallback(async () => {
    if (busy) return;

    if (!selectedDirectory) {
      setError("Pick a folder first");
      return;
    }
    if (!isAuthenticated) {
      setError("Sign in to PostHog Code first");
      return;
    }

    const content = getContent();
    const xml = contentToXml(content).trim();
    if (!xml) return;

    const plainText = getText()?.trim();
    if (plainText) {
      useTaskInputHistoryStore.getState().addPrompt(plainText);
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const workspaceMode = effectiveWorkspaceMode;
      const branchForTaskCreation =
        workspaceMode === "worktree"
          ? (selectedBranch ?? defaultBranch ?? null)
          : null;
      const currentModel =
        modelOption?.type === "select" ? modelOption.currentValue : null;
      const currentReasoningLevel =
        thoughtOption?.type === "select" ? thoughtOption.currentValue : null;
      const adapterDefault = adapter === "codex" ? "auto" : "plan";
      const modeFallback =
        defaultInitialTaskMode === "last_used"
          ? (lastUsedInitialTaskMode ?? adapterDefault)
          : adapterDefault;
      const currentExecutionMode =
        getCurrentModeFromConfigOptions(
          modeOption ? [modeOption] : undefined,
        ) ?? modeFallback;

      // Hand the request to the main window so it runs the task-creation
      // saga in its own renderer context (session store, folder cache, etc.).
      await trpcClient.quickEntry.requestCreateTask.mutate({
        content: xml,
        repoPath: selectedDirectory,
        workspaceMode,
        branch: branchForTaskCreation,
        adapter,
        model: currentModel,
        reasoningLevel: currentReasoningLevel,
        executionMode: currentExecutionMode,
      });

      // In-panel confirmation, then dismiss the overlay and reveal the app.
      setConfirming(true);
      confirmTimerRef.current = window.setTimeout(() => {
        confirmTimerRef.current = null;
        clear();
        setConfirming(false);
        trpcClient.quickEntry.completeSubmit.mutate().catch((err) => {
          log.warn("Failed to complete quick entry submit", { err });
        });
      }, CONFIRMATION_MS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      log.error("Quick entry submit threw", { err });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    busy,
    selectedDirectory,
    selectedBranch,
    defaultBranch,
    isAuthenticated,
    adapter,
    effectiveWorkspaceMode,
    modelOption,
    thoughtOption,
    modeOption,
    defaultInitialTaskMode,
    lastUsedInitialTaskMode,
    getContent,
    getText,
    clear,
  ]);

  // The tiptap Enter handler is bound once; route it through a ref so it
  // always sees the latest submit closure.
  const handleSubmitRef = useRef<(() => Promise<void>) | null>(null);
  handleSubmitRef.current = canSubmit ? handleSubmit : null;

  useEffect(
    () => () => {
      if (confirmTimerRef.current !== null) {
        window.clearTimeout(confirmTimerRef.current);
      }
    },
    [],
  );

  // Mode/model/effort option views.
  const modeItems = useMemo(() => {
    if (modeOption?.type !== "select") return [];
    return flattenSelectOptions(modeOption.options).filter(
      (opt) => opt.value !== "bypassPermissions" && opt.value !== "full-access",
    );
  }, [modeOption]);
  const modeValue =
    modeOption?.type === "select" ? modeOption.currentValue : undefined;
  const isPlanMode = modeValue === "plan";
  const modeLabel = isPlanMode
    ? "Plan Mode"
    : (modeItems.find((o) => o.value === modeValue)?.name ?? "Mode");

  const modelItems = useMemo(
    () =>
      modelOption?.type === "select"
        ? flattenSelectOptions(modelOption.options)
        : [],
    [modelOption],
  );
  const modelGroups = useMemo(() => {
    if (modelOption?.type !== "select" || modelOption.options.length === 0) {
      return undefined;
    }
    return "group" in modelOption.options[0]
      ? (modelOption.options as SessionConfigSelectGroup[])
      : undefined;
  }, [modelOption]);
  const modelValue =
    modelOption?.type === "select" ? modelOption.currentValue : undefined;
  const modelLabel =
    modelItems.find((o) => o.value === modelValue)?.name ?? "Model";

  const thoughtItems = useMemo(
    () =>
      thoughtOption?.type === "select"
        ? flattenSelectOptions(thoughtOption.options)
        : [],
    [thoughtOption],
  );
  const thoughtValue =
    thoughtOption?.type === "select" ? thoughtOption.currentValue : undefined;
  const thoughtLabel =
    thoughtItems.find((o) => o.value === thoughtValue)?.name ?? "Effort";

  const hasHistory = useTaskInputHistoryStore((s) => s.entries.length > 0);

  const shortcutLabel = formatHotkey(acceleratorToHotkey(quickEntryShortcut));

  // Accent vars live on <html> (not .qe-root) so portaled popover menus
  // inherit them too.
  useEffect(() => {
    const accent = isPlanMode ? PLAN_ACCENT : AGENT_ACCENT;
    const root = document.documentElement;
    for (const [name, value] of Object.entries(accent)) {
      root.style.setProperty(name, value);
    }
    root.style.setProperty(
      "--qe-glow",
      "color-mix(in srgb, var(--qe-accent) 20%, transparent)",
    );
  }, [isPlanMode]);

  const handleBackdropMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) hideWindow();
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss; Esc covers keyboard
    <div
      className="qe-root flex h-full w-full flex-col items-center"
      onMouseDown={handleBackdropMouseDown}
    >
      <section
        className="qe-panel flex w-full flex-col gap-3 px-[14px] py-3"
        data-focused={editorFocused || undefined}
        aria-label="Quick entry"
      >
        {confirming ? (
          <div className="qe-confirm flex items-center justify-center gap-3 py-8">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full"
              style={{
                background: "var(--qe-accent)",
                color: "var(--qe-on-accent)",
              }}
            >
              <Check size={15} weight="bold" />
            </span>
            <Text className="text-[14px] text-[rgba(255,255,255,.85)]">
              Task created — opening in PostHog Code…
            </Text>
          </div>
        ) : !isAuthenticated ? (
          <div className="flex items-center justify-center py-8">
            <Text className="text-[14px] text-[rgba(255,255,255,.85)]">
              Sign in to PostHog Code to use quick entry.
            </Text>
          </div>
        ) : (
          <>
            {/* Header: repo + branch chips, shortcut keycap */}
            <div className="flex min-w-0 items-center gap-2">
              <RepoChip
                value={selectedDirectory}
                onChange={setSelectedDirectory}
                disabled={busy}
              />
              <BranchChip
                repoPath={selectedDirectory || null}
                workspaceMode={effectiveWorkspaceMode}
                currentBranch={currentBranch ?? null}
                defaultBranch={defaultBranch ?? null}
                selectedBranch={selectedBranch}
                onBranchSelect={setSelectedBranch}
                disabled={busy}
              />
              <span className="ml-auto shrink-0">
                <Keycap>{shortcutLabel}</Keycap>
              </span>
            </div>

            {/* Input */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: focus proxy for the embedded editor */}
            <div
              className="qe-editor cli-editor-scroll min-h-[28px] cursor-text"
              onMouseDown={(e) => {
                const target = e.target as HTMLElement;
                if (!target.closest(".ProseMirror")) {
                  e.preventDefault();
                  focus();
                }
              }}
            >
              <TiptapEditorContent editor={editor} />
            </div>

            {/* Attachment chips */}
            {attachments.length > 0 && (
              <AttachmentsBar
                attachments={attachments}
                onRemove={removeAttachment}
              />
            )}

            {/* Toolbar */}
            <div className="qe-toolbar flex items-center gap-1">
              <AttachmentMenu
                disabled={busy}
                repoPath={selectedDirectory || null}
                onAddAttachment={addAttachment}
                onInsertChip={insertChip}
                onRemoveChip={removeChipById}
              />
              <span className="qe-divider" />
              <GlassSelect
                icon={getModeStyle(modeValue ?? "plan").icon}
                label={modeLabel}
                items={modeItems}
                currentValue={modeValue}
                onSelect={handleModeChange}
                disabled={busy || isPreviewLoading}
                accented
                aria-label="Mode"
              />
              <GlassSelect
                icon={<Cpu size={13} />}
                label={modelLabel}
                items={modelItems}
                groups={modelGroups}
                currentValue={modelValue}
                onSelect={handleModelChange}
                disabled={busy || isPreviewLoading}
                aria-label="Model"
                footer={
                  <AdapterSwitchItem
                    adapter={adapter}
                    onAdapterChange={setLastUsedAdapter}
                  />
                }
              />
              {thoughtItems.length > 0 && (
                <GlassSelect
                  icon={<Gauge size={13} />}
                  label={thoughtLabel}
                  items={thoughtItems}
                  currentValue={thoughtValue}
                  onSelect={handleThoughtChange}
                  disabled={busy || isPreviewLoading}
                  aria-label="Reasoning effort"
                />
              )}
              <span className="ml-auto flex items-center gap-3">
                <span className="qe-hint">
                  @ files / skills{hasHistory ? " ↑ history" : ""}
                </span>
                <button
                  type="button"
                  className="qe-send"
                  disabled={!canSubmit}
                  aria-label="Create task"
                  onClick={() => {
                    if (canSubmit) void handleSubmit();
                  }}
                >
                  <ArrowUp size={15} weight="bold" />
                </button>
              </span>
            </div>

            {error && (
              <Text className="text-(--red-10) text-[12px]">{error}</Text>
            )}
          </>
        )}
      </section>
    </div>
  );
}
