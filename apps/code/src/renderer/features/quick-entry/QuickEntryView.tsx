import { ButtonGroup } from "@posthog/quill";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { FolderPicker } from "@posthog/ui/features/folder-picker/FolderPicker";
import { BranchSelector } from "@posthog/ui/features/git-interaction/components/BranchSelector";
import { useGitQueries } from "@posthog/ui/features/git-interaction/useGitQueries";
import { PromptInput } from "@posthog/ui/features/message-editor/components/PromptInput";
import { contentToXml } from "@posthog/ui/features/message-editor/content";
import { useDraftStore } from "@posthog/ui/features/message-editor/draftStore";
import { useTaskInputHistoryStore } from "@posthog/ui/features/message-editor/taskInputHistoryStore";
import type { EditorHandle } from "@posthog/ui/features/message-editor/types";
import { ReasoningLevelSelector } from "@posthog/ui/features/sessions/components/ReasoningLevelSelector";
import { UnifiedModelSelector } from "@posthog/ui/features/sessions/components/UnifiedModelSelector";
import { getCurrentModeFromConfigOptions } from "@posthog/ui/features/sessions/sessionStore";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { usePreviewConfig } from "@posthog/ui/features/task-detail/hooks/usePreviewConfig";
import { Flex, Text } from "@radix-ui/themes";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { useSubscription } from "@trpc/tanstack-react-query";
import { logger } from "@utils/logger";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

const log = logger.scope("quick-entry-view");
const SESSION_ID = "quick-entry";

function hideWindow(): void {
  trpcClient.quickEntry.hide.mutate().catch((err) => {
    log.warn("Failed to hide quick entry window", { err });
  });
}

export function QuickEntryView() {
  const trpcReact = useTRPC();
  const editorRef = useRef<EditorHandle | null>(null);
  const [selectedDirectory, setSelectedDirectory] = useState<string>("");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorIsEmpty, setEditorIsEmpty] = useState(true);

  const { currentBranch, branchLoading, defaultBranch, busyState } =
    useGitQueries(selectedDirectory);

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
  } = useSettingsStore();

  const adapter = lastUsedAdapter ?? "claude";
  // Cloud isn't supported from quick entry (no cloud repo picker here).
  // Default to worktree so branch selection is meaningful; otherwise use
  // the user's preferred local mode.
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
        editorRef.current?.focus();
      },
    }),
  );

  useSubscription(
    trpcReact.quickEntry.onHide.subscriptionOptions(undefined, {
      onData: () => {
        editorRef.current?.clear();
        setError(null);
      },
    }),
  );

  // Reset branch selection when the repo changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only reset when repo changes
  useEffect(() => {
    setSelectedBranch(null);
  }, [selectedDirectory]);

  useHotkeys(
    "escape",
    () => {
      hideWindow();
    },
    {
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
  );

  const hasHistory = useTaskInputHistoryStore((s) => s.entries.length > 0);
  const hints = [
    "@ to add files",
    "/ for skills",
    hasHistory ? "↑↓ for history" : "",
  ]
    .filter(Boolean)
    .join(", ");

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

  const canSubmit =
    !!editorRef.current &&
    !!selectedDirectory &&
    !editorIsEmpty &&
    !isSubmitting;

  const handleSubmit = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || isSubmitting) return;

    if (!selectedDirectory) {
      setError("Pick a folder first");
      return;
    }
    if (!isAuthenticated) {
      setError("Sign in to PostHog Code first");
      return;
    }

    const content = editor.getContent();
    const xml = contentToXml(content).trim();
    if (!xml) return;

    const plainText = editor.getText()?.trim();
    if (plainText) {
      useTaskInputHistoryStore.getState().addPrompt(plainText);
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const workspaceMode = effectiveWorkspaceMode;
      const branchForTaskCreation =
        workspaceMode === "worktree" ? selectedBranch : null;
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

      editor.clear();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      log.error("Quick entry submit threw", { err });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    selectedDirectory,
    selectedBranch,
    isAuthenticated,
    adapter,
    effectiveWorkspaceMode,
    modelOption,
    thoughtOption,
    modeOption,
    defaultInitialTaskMode,
    lastUsedInitialTaskMode,
  ]);

  const getPromptHistory = useCallback(
    () => useTaskInputHistoryStore.getState().entries.map((e) => e.text),
    [],
  );

  if (!isAuthenticated) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4">
        <Text className="text-(--gray-12) text-sm">
          Sign in to PostHog Code to use quick entry.
        </Text>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-start justify-center p-2">
      <div className="flex w-full flex-col gap-2">
        <Flex gap="2" align="center" className="min-w-0">
          <ButtonGroup>
            <FolderPicker
              value={selectedDirectory}
              onChange={setSelectedDirectory}
              placeholder="Select repository..."
            />
            <BranchSelector
              repoPath={selectedDirectory || null}
              currentBranch={currentBranch}
              defaultBranch={defaultBranch}
              disabled={isSubmitting}
              loading={branchLoading}
              workspaceMode={effectiveWorkspaceMode}
              selectedBranch={selectedBranch}
              onBranchSelect={setSelectedBranch}
              busyState={busyState}
            />
          </ButtonGroup>
        </Flex>

        <Flex direction="column" gap="0">
          <PromptInput
            ref={editorRef}
            sessionId={SESSION_ID}
            placeholder={`What do you want to ship? ${hints}`}
            editorHeight="default"
            disabled={isSubmitting}
            isLoading={isSubmitting}
            autoFocus
            clearOnSubmit={false}
            submitDisabledExternal={!canSubmit}
            repoPath={selectedDirectory || undefined}
            modeOption={modeOption}
            onModeChange={handleModeChange}
            enableCommands
            enableBashMode={false}
            modelSelector={
              <UnifiedModelSelector
                modelOption={modelOption}
                adapter={adapter}
                onAdapterChange={setLastUsedAdapter}
                disabled={isSubmitting}
                isConnecting={isPreviewLoading}
                onModelChange={handleModelChange}
              />
            }
            reasoningSelector={
              !isPreviewLoading && (
                <ReasoningLevelSelector
                  thoughtOption={thoughtOption}
                  adapter={adapter}
                  onChange={handleThoughtChange}
                  disabled={isSubmitting}
                />
              )
            }
            getPromptHistory={getPromptHistory}
            onEmptyChange={setEditorIsEmpty}
            onSubmitClick={() => {
              void handleSubmit();
            }}
            onSubmit={() => {
              if (canSubmit) void handleSubmit();
            }}
          />
        </Flex>

        {error && <Text className="px-1 text-(--red-10) text-xs">{error}</Text>}
      </div>
    </div>
  );
}
