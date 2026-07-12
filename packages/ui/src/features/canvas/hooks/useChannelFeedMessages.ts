import type { ChannelFeedMessage } from "@posthog/shared/domain-types";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useMemo } from "react";

// Multiplayer, like the task feed: poll so a teammate's announcement appears
// without a dedicated push channel.
const CHANNEL_FEED_MESSAGES_POLL_INTERVAL_MS = 5_000;

// A channel-feed system message flattened to what the feed renders.
export interface ChannelFeedSystemMessage {
  id: string;
  /** ISO; interleaved with task cards in the feed. */
  createdAt: string;
  text: string;
}

export function channelFeedMessagesQueryKey(channelId: string | undefined) {
  return ["channel-feed-messages", channelId ?? "none"] as const;
}

// Render the announcement from its event + structured payload (rename-safe),
// falling back to the freeform content.
function messageText(message: ChannelFeedMessage): string {
  const actor = userDisplayName(message.author ?? null);
  const contextName =
    typeof message.payload?.context_name === "string"
      ? message.payload.context_name
      : "";
  switch (message.event) {
    // Server-emitted when the backend channel is created; context_created is the
    // legacy client-posted equivalent, kept for older rows.
    case "channel_created":
    case "context_created":
      return `${actor} created this context`;
    case "context_md_building":
      return `${actor} is building CONTEXT.md${contextName ? ` for ${contextName}` : ""}`;
    default:
      return message.content || `${actor} posted an update`;
  }
}

/**
 * A channel's durable "PostHog agent" announcements (context created, CONTEXT.md
 * being built), oldest first, flattened to display text.
 */
export function useChannelFeedMessages(channelId: string | undefined): {
  messages: ChannelFeedSystemMessage[];
  isLoading: boolean;
} {
  const query = useAuthenticatedQuery<ChannelFeedMessage[]>(
    channelFeedMessagesQueryKey(channelId),
    (client) => client.getChannelFeed(channelId as string),
    {
      enabled: !!channelId,
      refetchInterval: CHANNEL_FEED_MESSAGES_POLL_INTERVAL_MS,
    },
  );
  const messages = useMemo(
    () =>
      (query.data ?? []).map((m) => ({
        id: m.id,
        createdAt: m.created_at,
        text: messageText(m),
      })),
    [query.data],
  );
  return { messages, isLoading: query.isLoading };
}
