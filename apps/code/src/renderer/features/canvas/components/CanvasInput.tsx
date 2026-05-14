import { DotPatternBackground } from "@components/DotPatternBackground";
import { useAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useFolders } from "@features/folders/hooks/useFolders";
import { PromptInput } from "@features/message-editor/components/PromptInput";
import { useDraftStore } from "@features/message-editor/stores/draftStore";
import type { EditorHandle } from "@features/message-editor/types";
import { useCanvasChatStore } from "@features/rendering-canvas/canvasChatStore";
import { getCurrentModeFromConfigOptions } from "@features/sessions/stores/sessionStore";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { usePreviewConfig } from "@features/task-detail/hooks/usePreviewConfig";
import { useTaskCreation } from "@features/task-detail/hooks/useTaskCreation";
import { useConnectivity } from "@hooks/useConnectivity";
import { useUserRepositoryIntegration } from "@hooks/useIntegrations";
import { Button, Flex, Heading, Text } from "@radix-ui/themes";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { useNavigationStore } from "@stores/navigationStore";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface CanvasInputProps {
  canvasId: string;
}

export function CanvasInput({ canvasId }: CanvasInputProps) {
  const editorRef = useRef<EditorHandle>(null);
  const sessionId = `canvas-input:${canvasId}`;
  const trpcReact = useTRPC();
  const { folders } = useFolders();
  const { isOnline } = useConnectivity();
  const client = useAuthenticatedClient();

  const { data: canvas } = useQuery({
    queryKey: ["rendering-canvas", canvasId],
    queryFn: () => client.getRenderingCanvas(canvasId),
  });

  const messagePrefix = useMemo(() => {
    if (!canvas) return undefined;
    const path = canvas.path ? canvas.path : "(unset)";
    return `[Canvas context: you are editing an existing PostHog rendering canvas. id=${canvas.id} name=${JSON.stringify(canvas.name)} path=${path}. To edit a canvas, you must fetch the current code, generate a new version, and save it.]`;
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
      useCanvasChatStore.getState().setActiveTask(canvasId, task);
      useCanvasChatStore.getState().setOpen(true);
      useNavigationStore.getState().navigateToCanvasInput(canvasId);
    },
  });

  const handleGuess = useCallback(() => {
    const prompt = "Generate a canvas based on existing PostHog data";
    editorRef.current?.setContent(prompt);
    setTimeout(() => {
      handleSubmit();
    }, 0);
  }, [handleSubmit]);

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
    <Flex
      align="center"
      justify="center"
      height="100%"
      className="relative px-4"
    >
      <DotPatternBackground className="h-[100.333%]" />
      <Flex
        direction="column"
        gap="3"
        className="relative z-[1] w-full max-w-[600px]"
      >
        <Flex direction="column" gap="1">
          <Heading size="4" className="text-(--gray-12)">
            Create a canvas
          </Heading>
          <Text size="2" color="gray">
            Use AI to generate a view of PostHog data — charts, related flags,
            experiments, and more.
          </Text>
        </Flex>

        <PromptInput
          ref={editorRef}
          sessionId={sessionId}
          placeholder="What should this canvas show?"
          editorHeight="large"
          autoFocus
          clearOnSubmit={false}
          disabled={isCreatingTask}
          isLoading={isCreatingTask || isPreviewLoading}
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

        <Flex justify="end">
          <Button
            variant="soft"
            size="2"
            onClick={handleGuess}
            disabled={isCreatingTask || !isOnline}
          >
            Guess what to show
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}
