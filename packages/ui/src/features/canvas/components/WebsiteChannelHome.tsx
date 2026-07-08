import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import type { Task } from "@posthog/shared/domain-types";
import { CHANNEL_TASK_SUGGESTIONS } from "@posthog/ui/features/canvas/channelTaskSuggestions";
import { ChannelFeedView } from "@posthog/ui/features/canvas/components/ChannelFeedView";
import { ChannelHeader } from "@posthog/ui/features/canvas/components/ChannelHeader";
import {
  ChannelHomeComposer,
  type ChannelHomeComposerHandle,
} from "@posthog/ui/features/canvas/components/ChannelHomeComposer";
import { ThreadSidebar } from "@posthog/ui/features/canvas/components/ThreadSidebar";
import {
  channelFeedQueryKey,
  useChannelFeed,
} from "@posthog/ui/features/canvas/hooks/useChannelFeed";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useChannelTaskMutations } from "@posthog/ui/features/canvas/hooks/useChannelTasks";
import { useFolderInstructions } from "@posthog/ui/features/canvas/hooks/useFolderInstructions";
import { useBackendChannel } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useThreadPanelStore } from "@posthog/ui/features/canvas/stores/threadPanelStore";
import { SuggestedPromptCard } from "@posthog/ui/features/task-detail/components/SuggestedPromptCard";
import { taskDetailQuery } from "@posthog/ui/features/tasks/queries";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { Text } from "@radix-ui/themes";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useRef } from "react";

// A channel: a Slack-style multiplayer feed. Each member message kicks off a
// task rendered as a card everyone in the channel sees; the composer stays
// pinned at the bottom and threads open in a right-hand panel. The channel's
// artifacts/history/context views stay in the tabs above (ChannelHeader).
export function WebsiteChannelHome({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { channels } = useChannels();
  const channelName = channels.find((c) => c.id === channelId)?.name;
  const { fileTask } = useChannelTaskMutations();

  const { data: instructions } = useFolderInstructions(channelId);
  const channelContext = instructions?.content;

  // The folder channel maps onto a backend channel (by name; "me" → the
  // personal channel), which owns the task feed and threads.
  const { channel: backendChannel } = useBackendChannel(channelName);
  const { tasks, isLoading } = useChannelFeed(backendChannel?.id);

  useSetHeaderContent(
    useMemo(() => <ChannelHeader channelId={channelId} />, [channelId]),
  );

  const composerRef = useRef<ChannelHomeComposerHandle>(null);

  // Which thread is open is tracked per tab (keyed by channelId), so switching
  // between channel tabs keeps each tab's own thread docked.
  const threadTaskId = useThreadPanelStore((s) => s.openByChannel[channelId]);
  const openThread = useThreadPanelStore((s) => s.openThread);
  const closeThread = useThreadPanelStore((s) => s.closeThread);

  const handleSuggestionSelect = useCallback(
    (prompt: string, mode?: string) => {
      composerRef.current?.applySuggestion(prompt, mode);
    },
    [],
  );

  const invalidateFeed = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: channelFeedQueryKey(backendChannel?.id),
    });
  }, [queryClient, backendChannel?.id]);

  // Slack behavior: submitting keeps you in the channel; the new card appears
  // in the feed and updates live. Filing into the folder keeps the Artifacts /
  // Recents tabs working.
  const onTaskCreated = useCallback(
    (task: Task) => {
      queryClient.setQueryData(taskDetailQuery(task.id).queryKey, task);
      invalidateFeed();
      void fileTask(channelId, task.id, task.title)
        .then(() =>
          track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
            action_type: "file_task",
            surface: "channel_home",
            channel_id: channelId,
            task_id: task.id,
            success: true,
          }),
        )
        .catch((error: unknown) => {
          track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
            action_type: "file_task",
            surface: "channel_home",
            channel_id: channelId,
            task_id: task.id,
            success: false,
          });
          toast.error("Couldn't file task to channel", {
            description: error instanceof Error ? error.message : String(error),
          });
        });
    },
    [channelId, fileTask, invalidateFeed, queryClient],
  );

  // Clicking a task card or its "reply in thread" action both open the same
  // thread dock — the merged conversation with the task card and the agent's
  // live replies inline — rather than navigating away to the full task view.
  // The full view stays a click away (openFull). The feed keeps the two intents
  // as distinct props so they can diverge later without re-plumbing.
  const handleOpenTask = useCallback(
    (task: Task) => openThread(channelId, task.id),
    [openThread, channelId],
  );
  const handleOpenThread = handleOpenTask;

  const handleOpenFull = useCallback(
    (taskId: string) => {
      void navigate({
        to: "/website/$channelId/tasks/$taskId",
        params: { channelId, taskId },
      });
    },
    [channelId, navigate],
  );

  const threadTask = threadTaskId
    ? tasks.find((t) => t.id === threadTaskId)
    : undefined;

  const emptyState = (
    <div className="mx-auto flex min-h-full w-full max-w-[680px] flex-col justify-center gap-6 px-4 py-10">
      <div className="text-center">
        <h1 className="font-semibold text-2xl text-gray-12 tracking-tight">
          {channelName ? `Welcome to #${channelName}` : "Welcome"}
        </h1>
        <Text className="mt-2 block text-[13px] text-gray-10">
          Every message kicks off a task the whole channel can follow.
        </Text>
      </div>
      <div className="flex flex-col gap-2">
        <Text size="1" weight="medium" className="px-1 text-(--gray-11)">
          Suggestions
        </Text>
        <div className="grid grid-cols-2 gap-2">
          {CHANNEL_TASK_SUGGESTIONS.map((suggestion) => (
            <SuggestedPromptCard
              key={suggestion.label}
              suggestion={suggestion}
              onSelect={() =>
                handleSuggestionSelect(suggestion.prompt, suggestion.mode)
              }
            />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-w-0 bg-gray-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ChannelFeedView
          channelId={channelId}
          tasks={tasks}
          isLoading={isLoading}
          emptyState={emptyState}
          onOpenTask={handleOpenTask}
          onOpenThread={handleOpenThread}
        />
        <div className="mx-auto w-full px-4 pb-4">
          <ChannelHomeComposer
            ref={composerRef}
            channelId={channelId}
            channelName={channelName}
            channelContext={channelContext}
            backendChannelId={backendChannel?.id}
            onTaskCreated={onTaskCreated}
          />
        </div>
      </div>

      {threadTaskId && (
        <ThreadSidebar
          taskId={threadTaskId}
          channelId={channelId}
          task={threadTask}
          onClose={() => closeThread(channelId)}
          onOpenFull={() => handleOpenFull(threadTaskId)}
        />
      )}
    </div>
  );
}
