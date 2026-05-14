import { useAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useFolders } from "@features/folders/hooks/useFolders";
import { PromptInput } from "@features/message-editor/components/PromptInput";
import { useDraftStore } from "@features/message-editor/stores/draftStore";
import type { EditorHandle } from "@features/message-editor/types";
import {
  useCanvasActiveTask,
  useCanvasChatStore,
} from "@features/rendering-canvas/canvasChatStore";
import { getCurrentModeFromConfigOptions } from "@features/sessions/stores/sessionStore";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { TaskLogsPanel } from "@features/task-detail/components/TaskLogsPanel";
import { usePreviewConfig } from "@features/task-detail/hooks/usePreviewConfig";
import { useTaskCreation } from "@features/task-detail/hooks/useTaskCreation";
import { useConnectivity } from "@hooks/useConnectivity";
import { useUserRepositoryIntegration } from "@hooks/useIntegrations";
import { PlusCircle, X } from "@phosphor-icons/react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

interface CanvasChatPanelProps {
  canvasId: string;
}

export function CanvasChatPanel({ canvasId }: CanvasChatPanelProps) {
  const editorRef = useRef<EditorHandle>(null);
  const sessionId = `canvas-chat:${canvasId}`;
  const close = useCanvasChatStore((s) => s.close);
  const setActiveTask = useCanvasChatStore((s) => s.setActiveTask);
  const clearActiveTask = useCanvasChatStore((s) => s.clearActiveTask);
  const activeTask = useCanvasActiveTask(canvasId);
  const { isOnline } = useConnectivity();
  const trpcReact = useTRPC();
  const { folders } = useFolders();
  const client = useAuthenticatedClient();

  const { data: canvas } = useQuery({
    queryKey: ["rendering-canvas", canvasId],
    queryFn: () => client.getRenderingCanvas(canvasId),
  });

  const messagePrefix = useMemo(() => {
    if (!canvas) return undefined;
    const path = canvas.path ? canvas.path : "(unset)";
    return `[Canvas context: you are editing an existing PostHog rendering canvas. id=${canvas.id} name=${JSON.stringify(canvas.name)} path=${path}. To save changes, call create-canvas with the same id to overwrite this canvas's content.]`;
  }, [canvas]);

  const {
    lastUsedWorkspaceMode,
    lastUsedLocalWorkspaceMode,
    lastUsedAdapter,
    lastUsedCloudRepository,
    defaultInitialTaskMode,
    lastUsedInitialTaskMode,
    allowBypassPermissions,
    getLastUsedEnvironment,
  } = useSettingsStore();

  const adapter = lastUsedAdapter ?? "claude";

  const {
    repositories,
    getUserIntegrationIdForRepo,
    isLoadingRepos,
    hasGithubIntegration,
  } = useUserRepositoryIntegration();

  const cloudAvailable = isLoadingRepos || hasGithubIntegration;
  const workspaceMode = useMemo(() => {
    if (lastUsedWorkspaceMode === "cloud" && !cloudAvailable) {
      return lastUsedLocalWorkspaceMode;
    }
    return lastUsedWorkspaceMode || "local";
  }, [lastUsedWorkspaceMode, lastUsedLocalWorkspaceMode, cloudAvailable]);

  const { data: mostRecentRepo } = useQuery(
    trpcReact.folders.getMostRecentlyAccessedRepository.queryOptions(),
  );
  const selectedDirectory = mostRecentRepo?.path ?? folders[0]?.path ?? "";

  const selectedRepository = useMemo(() => {
    if (workspaceMode !== "cloud" || !lastUsedCloudRepository) return null;
    const lower = lastUsedCloudRepository.toLowerCase();
    return repositories.includes(lower) ? lower : null;
  }, [workspaceMode, lastUsedCloudRepository, repositories]);

  const githubUserIntegrationId = selectedRepository
    ? getUserIntegrationIdForRepo(selectedRepository)
    : undefined;

  const effectiveRepoPath =
    workspaceMode === "cloud" ? selectedRepository : selectedDirectory;
  const environmentId =
    workspaceMode === "worktree" && effectiveRepoPath
      ? getLastUsedEnvironment(effectiveRepoPath)
      : null;

  const {
    modeOption,
    modelOption,
    thoughtOption,
    isLoading: isPreviewLoading,
  } = usePreviewConfig(adapter);

  const currentModel =
    modelOption?.type === "select" ? modelOption.currentValue : undefined;
  const adapterDefault = adapter === "codex" ? "auto" : "plan";
  const modeFallback =
    defaultInitialTaskMode === "last_used"
      ? (lastUsedInitialTaskMode ?? adapterDefault)
      : adapterDefault;
  const currentExecutionMode =
    getCurrentModeFromConfigOptions(modeOption ? [modeOption] : undefined) ??
    modeFallback;
  const currentReasoningLevel =
    thoughtOption?.type === "select" ? thoughtOption.currentValue : undefined;

  const [editorIsEmpty, setEditorIsEmpty] = useState(true);

  const { isCreatingTask, canSubmit, handleSubmit } = useTaskCreation({
    editorRef,
    selectedDirectory,
    selectedRepository,
    githubUserIntegrationId,
    workspaceMode,
    branch: null,
    editorIsEmpty,
    adapter,
    executionMode: currentExecutionMode,
    model: currentModel,
    reasoningLevel: currentReasoningLevel,
    environmentId,
    messagePrefix,
    onTaskCreated: (task) => {
      setActiveTask(canvasId, task);
    },
  });

  // Populate skills/commands for `/` mentions
  useEffect(() => {
    let cancelled = false;
    trpcClient.skills.list.query().then((skills) => {
      if (cancelled) return;
      useDraftStore.getState().actions.setCommands(
        sessionId,
        skills.map((s) => ({ name: s.name, description: s.description })),
      );
    });
    return () => {
      cancelled = true;
      useDraftStore.getState().actions.clearCommands(sessionId);
    };
  }, [sessionId]);

  return (
    <Flex direction="column" height="100%">
      <Flex
        align="center"
        justify="between"
        className="shrink-0 border-(--gray-5) border-b px-3 py-2"
      >
        <span className="text-(--gray-12) text-sm">Chat</span>
        <Flex align="center" gap="1">
          {activeTask && (
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              onClick={() => clearActiveTask(canvasId)}
              aria-label="Start new chat"
              title="Start new chat"
            >
              <PlusCircle size={14} />
            </IconButton>
          )}
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={close}
            aria-label="Close chat panel"
          >
            <X size={14} />
          </IconButton>
        </Flex>
      </Flex>
      {activeTask ? (
        <Box className="min-h-0 flex-1 overflow-hidden">
          <TaskLogsPanel taskId={activeTask.id} task={activeTask} />
        </Box>
      ) : (
        <>
          <Box className="min-h-0 flex-1 overflow-y-auto p-3">
            <span className="text-(--gray-10) text-xs">
              Ask about this canvas or kick off a coding task…
            </span>
          </Box>
          <Box className="shrink-0 border-(--gray-4) border-t p-2">
            <PromptInput
              ref={editorRef}
              sessionId={sessionId}
              placeholder="What do you want to ship?"
              disabled={isCreatingTask}
              isLoading={isCreatingTask || isPreviewLoading}
              clearOnSubmit={false}
              submitDisabledExternal={!canSubmit || isCreatingTask || !isOnline}
              repoPath={
                workspaceMode === "cloud" ? null : selectedDirectory || null
              }
              allowBypassPermissions={allowBypassPermissions}
              enableCommands
              enableBashMode={false}
              onEmptyChange={setEditorIsEmpty}
              onSubmitClick={handleSubmit}
              onSubmit={() => {
                if (canSubmit) handleSubmit();
              }}
            />
          </Box>
        </>
      )}
    </Flex>
  );
}
