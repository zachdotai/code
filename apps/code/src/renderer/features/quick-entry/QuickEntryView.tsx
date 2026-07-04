import "./quick-entry-glass.css";
import type { SessionConfigSelectGroup } from "@agentclientprotocol/sdk";
import { ArrowUp, Check, Cpu, Gauge, Paperclip } from "@phosphor-icons/react";
import { deriveFileLabel } from "@posthog/core/message-editor/content";
import { isRasterImageFile } from "@posthog/shared";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { formatHotkey } from "@posthog/ui/features/command/keyboard-shortcuts";
import { useGitQueries } from "@posthog/ui/features/git-interaction/useGitQueries";
import { AttachmentsBar } from "@posthog/ui/features/message-editor/components/AttachmentsBar";
import { contentToXml } from "@posthog/ui/features/message-editor/content";
import { useDraftStore } from "@posthog/ui/features/message-editor/draftStore";
import { selectAttachments } from "@posthog/ui/features/message-editor/hostApi";
import { useTaskInputHistoryStore } from "@posthog/ui/features/message-editor/taskInputHistoryStore";
import { TiptapEditorContent } from "@posthog/ui/features/message-editor/tiptap/editorSurface";
import { useTiptapEditor } from "@posthog/ui/features/message-editor/tiptap/useTiptapEditor";
import { persistImageFilePath } from "@posthog/ui/features/message-editor/utils/persistFile";
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
  BranchChip,
  GlassSelect,
  Keycap,
  RepoChip,
} from "./QuickEntryGlassControls";

const log = logger.scope("quick-entry-view");
const SESSION_ID = "quick-entry";
const CONFIRMATION_MS = 1200;
// Extra window height requested while the @-mention/skills suggestion popup
// (tippy, the only remaining in-page popover — pickers are native menus) is
// open, so it has room to render; the window otherwise hugs the panel because
// the vibrancy material fills the whole window rect.
const POPOVER_HEADROOM_PX = 320;
const POPOVER_SELECTOR = ".tippy-box";

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
  const panelRef = useRef<HTMLElement | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverOpenRef = useRef(false);
  const panelHeightRef = useRef(168);

  const reportWindowHeight = useCallback(() => {
    const height =
      panelHeightRef.current +
      (popoverOpenRef.current ? POPOVER_HEADROOM_PX : 0);
    trpcClient.quickEntry.setContentHeight.mutate({ height }).catch(() => {
      // resize is cosmetic; never break the widget over it
    });
  }, []);

  // Window height follows the panel. While a popover is open the panel is
  // stretched to fill the window (see [data-headroom] CSS), so keep the last
  // natural measurement instead of the stretched one.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () => {
      if (!popoverOpenRef.current) {
        panelHeightRef.current = Math.ceil(
          panel.getBoundingClientRect().height,
        );
      }
      reportWindowHeight();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    measure();
    return () => observer.disconnect();
  }, [reportWindowHeight]);

  // Popovers are portals; watch the DOM instead of wiring every picker. The
  // collapse is debounced so quickly re-opening a menu doesn't bounce the
  // window height.
  useEffect(() => {
    let collapseTimer: number | null = null;
    const sync = () => {
      const open = document.querySelector(POPOVER_SELECTOR) !== null;
      if (open) {
        if (collapseTimer !== null) {
          window.clearTimeout(collapseTimer);
          collapseTimer = null;
        }
        if (!popoverOpenRef.current) {
          popoverOpenRef.current = true;
          setPopoverOpen(true);
          reportWindowHeight();
        }
      } else if (popoverOpenRef.current && collapseTimer === null) {
        collapseTimer = window.setTimeout(() => {
          collapseTimer = null;
          popoverOpenRef.current = false;
          setPopoverOpen(false);
          reportWindowHeight();
        }, 140);
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => {
      observer.disconnect();
      if (collapseTimer !== null) window.clearTimeout(collapseTimer);
    };
  }, [reportWindowHeight]);

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

  // Native file picker instead of AttachmentMenu: quick entry has no task
  // yet (no directory-attach dialog) and no popover budget in the snug
  // vibrancy window. Images become attachments; files/folders become chips.
  const handleAttach = useCallback(async () => {
    try {
      const results = await selectAttachments({ mode: "both" });
      for (const { path: filePath, kind } of results) {
        if (kind === "file" && isRasterImageFile(filePath)) {
          const attachment = await persistImageFilePath(filePath);
          addAttachment(attachment);
        } else {
          insertChip({
            type: kind === "directory" ? "folder" : "file",
            id: filePath,
            label: deriveFileLabel(filePath),
          });
        }
      }
    } catch (err) {
      log.warn("Quick entry attach failed", { err });
    }
  }, [addAttachment, insertChip]);

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
      "color-mix(in srgb, var(--qe-accent) 14%, transparent)",
    );
  }, [isPlanMode]);

  return (
    // The window hugs the panel; while a popover is open the window gains
    // headroom and the panel stretches so the glass stays uniform behind it.
    <div className="qe-root flex h-full w-full flex-col justify-end">
      <section
        ref={panelRef}
        className="qe-panel flex w-full flex-col gap-3 px-[14px] py-3"
        data-focused={editorFocused || undefined}
        data-headroom={popoverOpen || undefined}
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
              <button
                type="button"
                className="qe-chip !border-transparent !bg-transparent px-2"
                disabled={busy}
                aria-label="Attach files"
                onClick={() => void handleAttach()}
              >
                <Paperclip size={14} className="opacity-70" />
              </button>
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
                adapter={adapter}
                onAdapterChange={setLastUsedAdapter}
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
