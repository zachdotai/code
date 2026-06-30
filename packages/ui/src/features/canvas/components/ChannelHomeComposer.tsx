import { FileText, X } from "@phosphor-icons/react";
import { isValidConfigValue } from "@posthog/core/task-detail/configOptions";
import type { Task } from "@posthog/shared/domain-types";
import { Tooltip } from "@radix-ui/themes";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useConnectivity } from "../../../hooks/useConnectivity";
import { PromptInput } from "../../message-editor/components/PromptInput";
import { useDraftStore } from "../../message-editor/draftStore";
import type { EditorHandle } from "../../message-editor/types";
import { ReasoningLevelSelector } from "../../sessions/components/ReasoningLevelSelector";
import { UnifiedModelSelector } from "../../sessions/components/UnifiedModelSelector";
import { getCurrentModeFromConfigOptions } from "../../sessions/sessionStore";
import {
  type AgentAdapter,
  useSettingsStore,
} from "../../settings/settingsStore";
import {
  type WorkspaceMode,
  WorkspaceModeSelect,
} from "../../task-detail/components/WorkspaceModeSelect";
import { usePreviewConfig } from "../../task-detail/hooks/usePreviewConfig";
import { useTaskCreation } from "../../task-detail/hooks/useTaskCreation";

export interface ChannelHomeComposerHandle {
  /** Drop a starter prompt into the editor and apply its mode, if any. */
  applySuggestion: (prompt: string, mode?: string) => void;
}

interface ChannelHomeComposerProps {
  channelId: string;
  channelName?: string;
  /** Channel CONTEXT.md, attached to the created task as background. */
  channelContext?: string;
  /** Fires as the editor goes empty ⇄ non-empty, so the home page can fade out
   * its suggestions / lists while the user is typing. */
  onEmptyChange?: (isEmpty: boolean) => void;
  onTaskCreated: (task: Task) => void;
}

// The prompt box at the bottom of a channel's homepage. A trimmed-down sibling
// of TaskInput: it reuses the same task-creation pipeline (model/mode/reasoning
// preview config + useTaskCreation) but drops the repo/branch pickers — channel
// tasks run repo-less and the agent attaches a repo lazily if it needs one. The
// starter-prompt suggestions render in the parent above the box; this owns the
// local/cloud selector.
export const ChannelHomeComposer = forwardRef<
  ChannelHomeComposerHandle,
  ChannelHomeComposerProps
>(function ChannelHomeComposer(
  { channelId, channelName, channelContext, onEmptyChange, onTaskCreated },
  ref,
) {
  const sessionId = `channel-home:${channelId}`;
  const editorRef = useRef<EditorHandle>(null);
  const [editorIsEmpty, setEditorIsEmpty] = useState(true);
  const { isOnline } = useConnectivity();

  // The channel CONTEXT.md is attached to new tasks by default; the chip below
  // the prompt surfaces that it's included and lets the user drop it from this
  // task. Re-include whenever the source context changes (e.g. the doc loads or
  // the channel switches) so a dismissal doesn't stick. Mirrors TaskInput.
  const [channelContextDismissed, setChannelContextDismissed] = useState(false);
  const lastChannelContextRef = useRef(channelContext);
  useEffect(() => {
    if (lastChannelContextRef.current !== channelContext) {
      lastChannelContextRef.current = channelContext;
      setChannelContextDismissed(false);
    }
  }, [channelContext]);
  const includeChannelContext = !!channelContext && !channelContextDismissed;

  const handleEmptyChange = useCallback(
    (isEmpty: boolean) => {
      setEditorIsEmpty(isEmpty);
      onEmptyChange?.(isEmpty);
    },
    [onEmptyChange],
  );

  const {
    lastUsedAdapter,
    setLastUsedAdapter,
    lastUsedWorkspaceMode,
    setLastUsedWorkspaceMode,
    setLastUsedLocalWorkspaceMode,
    allowBypassPermissions,
    defaultInitialTaskMode,
    lastUsedInitialTaskMode,
    setLastUsedReasoningEffort,
    setLastUsedModel,
  } = useSettingsStore();

  const adapter = lastUsedAdapter;
  const setAdapter = useCallback(
    (next: AgentAdapter) => setLastUsedAdapter(next),
    [setLastUsedAdapter],
  );

  // Repo-less channel tasks only run local or cloud (worktree needs a repo), so
  // collapse any lingering worktree preference down to local for the initial pick.
  const [workspaceMode, setWorkspaceModeState] = useState<WorkspaceMode>(
    lastUsedWorkspaceMode === "cloud" ? "cloud" : "local",
  );
  const [selectedCloudEnvId, setSelectedCloudEnvId] = useState<string | null>(
    null,
  );
  const setWorkspaceMode = useCallback(
    (mode: WorkspaceMode) => {
      setWorkspaceModeState(mode);
      setLastUsedWorkspaceMode(mode);
      if (mode !== "cloud") setLastUsedLocalWorkspaceMode(mode);
    },
    [setLastUsedWorkspaceMode, setLastUsedLocalWorkspaceMode],
  );

  const { modeOption, modelOption, thoughtOption, isLoading, setConfigOption } =
    usePreviewConfig(adapter);

  const currentModel =
    modelOption?.type === "select" ? modelOption.currentValue : undefined;
  const adapterDefault = adapter === "codex" ? "auto" : "plan";
  const modeFallback =
    defaultInitialTaskMode === "last_used" &&
    lastUsedInitialTaskMode &&
    isValidConfigValue(modeOption, lastUsedInitialTaskMode)
      ? lastUsedInitialTaskMode
      : adapterDefault;
  const currentExecutionMode =
    getCurrentModeFromConfigOptions(modeOption ? [modeOption] : undefined) ??
    modeFallback;
  const currentReasoningLevel =
    thoughtOption?.type === "select" ? thoughtOption.currentValue : undefined;

  const { isCreatingTask, canSubmit, handleSubmit } = useTaskCreation({
    editorRef,
    sessionId,
    selectedDirectory: "",
    workspaceMode,
    sandboxEnvironmentId:
      workspaceMode === "cloud" && selectedCloudEnvId
        ? selectedCloudEnvId
        : undefined,
    editorIsEmpty,
    adapter,
    executionMode: currentExecutionMode,
    model: currentModel,
    reasoningLevel: currentReasoningLevel,
    allowNoRepo: true,
    channelContext: includeChannelContext ? channelContext : undefined,
    channelName,
    onTaskCreated,
  });

  const handleModeChange = useCallback(
    (value: string) => {
      if (modeOption) setConfigOption(modeOption.id, value);
    },
    [modeOption, setConfigOption],
  );
  const handleModelChange = useCallback(
    (value: string) => {
      if (modelOption) {
        setConfigOption(modelOption.id, value);
        setLastUsedModel(value);
      }
    },
    [modelOption, setConfigOption, setLastUsedModel],
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

  useImperativeHandle(
    ref,
    () => ({
      applySuggestion: (prompt: string, mode?: string) => {
        // Pending content (not setContent) preserves the multi-line template's
        // line breaks and focuses at the end; mirrors the new-task screen.
        useDraftStore.getState().actions.setPendingContent(sessionId, {
          segments: [{ type: "text", text: prompt }],
        });
        if (mode && isValidConfigValue(modeOption, mode)) {
          setConfigOption(modeOption.id, mode);
        }
      },
    }),
    [sessionId, modeOption, setConfigOption],
  );

  const hints = ["@ to add files", "/ for skills"].join(", ");

  return (
    <div className="flex w-full flex-col">
      <div className="mb-2 flex items-center gap-2">
        <WorkspaceModeSelect
          value={workspaceMode}
          onChange={setWorkspaceMode}
          overrideModes={["local", "cloud"]}
          selectedCloudEnvironmentId={selectedCloudEnvId}
          onCloudEnvironmentChange={setSelectedCloudEnvId}
          size="1"
          disabled={isCreatingTask}
        />
      </div>

      <PromptInput
        ref={editorRef}
        sessionId={sessionId}
        placeholder={`What do you want to ship? ${hints}`}
        editorHeight="large"
        disabled={isCreatingTask}
        isLoading={isCreatingTask}
        autoFocus
        clearOnSubmit={false}
        submitDisabledExternal={
          !canSubmit || isCreatingTask || !isOnline || isLoading
        }
        modeOption={modeOption}
        onModeChange={handleModeChange}
        allowBypassPermissions={allowBypassPermissions}
        enableCommands
        enableBashMode={false}
        modelSelector={
          <UnifiedModelSelector
            modelOption={modelOption}
            adapter={adapter ?? "claude"}
            onAdapterChange={setAdapter}
            disabled={isCreatingTask}
            isConnecting={isLoading}
            onModelChange={handleModelChange}
          />
        }
        reasoningSelector={
          !isLoading && (
            <ReasoningLevelSelector
              thoughtOption={thoughtOption}
              adapter={adapter}
              onChange={handleThoughtChange}
              disabled={isCreatingTask}
            />
          )
        }
        onEmptyChange={handleEmptyChange}
        onSubmitClick={handleSubmit}
        onSubmit={() => {
          if (canSubmit) handleSubmit();
        }}
      />

      {includeChannelContext && (
        <div className="mt-2 flex select-none flex-wrap items-center gap-1.5 self-start rounded-md border border-gray-6 bg-gray-2 px-2 py-1 text-[12px] text-gray-11">
          <span className="shrink-0 text-gray-10">Using:</span>
          <span className="inline-flex items-center gap-1 rounded-[var(--radius-1)] bg-[var(--gray-a3)] px-1.5 py-px font-medium text-[var(--gray-11)]">
            <FileText size={12} />
            <span className="truncate">
              {channelName ? `#${channelName} ` : ""}CONTEXT.md
            </span>
            <Tooltip content="Don't include this context">
              <button
                type="button"
                onClick={() => setChannelContextDismissed(true)}
                aria-label="Remove channel context from prompt"
                className="ml-0.5 inline-flex size-3.5 items-center justify-center rounded text-gray-10 hover:bg-gray-5 hover:text-gray-12"
              >
                <X size={12} />
              </button>
            </Tooltip>
          </span>
        </div>
      )}
    </div>
  );
});
