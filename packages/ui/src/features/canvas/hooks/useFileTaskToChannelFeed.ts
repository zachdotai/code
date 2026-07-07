import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import type { Task } from "@posthog/shared/domain-types";
import { channelFeedQueryKey } from "@posthog/ui/features/canvas/hooks/useChannelFeed";
import {
  normalizeChannelName,
  PERSONAL_CHANNEL_NAME,
} from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useAuthenticatedMutation } from "@posthog/ui/hooks/useAuthenticatedMutation";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Resolve the backend task channel that a folder channel (by display name)
 * maps onto, creating the public channel if it doesn't exist yet. Mirrors the
 * resolution in `useBackendChannel`, but runs imperatively for a channel
 * chosen at click time (e.g. the "File to…" menu).
 */
export async function resolveBackendChannelId(
  client: Pick<PostHogAPIClient, "getTaskChannels" | "resolveTaskChannel">,
  channelName: string,
): Promise<string> {
  const normalized = normalizeChannelName(channelName);
  if (normalized === PERSONAL_CHANNEL_NAME) {
    // Listing lazily provisions the requester's #me channel server-side.
    const channels = await client.getTaskChannels();
    const personal = channels.find((c) => c.channel_type === "personal");
    if (personal) return personal.id;
  }
  const channel = await client.resolveTaskChannel(normalized);
  return channel.id;
}

/**
 * Associate an existing task with a channel's backend feed so it shows up as a
 * thread item in the channel — the feed side `useChannelFeed` reads via
 * `getTasks({ channel })`. Filing to the desktop file system (see
 * `useChannelTaskMutations().fileTask`) only powers the Artifacts / Recents
 * tabs, so both are needed for a task to fully belong to a channel.
 */
export function useFileTaskToChannelFeed(): {
  fileTaskToChannelFeed: (
    channelName: string,
    taskId: string,
  ) => Promise<string>;
} {
  const queryClient = useQueryClient();
  const mutation = useAuthenticatedMutation(
    async (
      client,
      { channelName, taskId }: { channelName: string; taskId: string },
    ) => {
      const backendChannelId = await resolveBackendChannelId(
        client,
        channelName,
      );
      await client.updateTask(taskId, {
        channel: backendChannelId,
      } as Partial<Task> as Parameters<typeof client.updateTask>[1]);
      return backendChannelId;
    },
    {
      onSuccess: (backendChannelId) => {
        void queryClient.invalidateQueries({
          queryKey: channelFeedQueryKey(backendChannelId),
        });
      },
    },
  );

  return {
    fileTaskToChannelFeed: (channelName: string, taskId: string) =>
      mutation.mutateAsync({ channelName, taskId }),
  };
}
