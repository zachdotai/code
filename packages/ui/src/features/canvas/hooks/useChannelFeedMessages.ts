import type {
  ChannelFeedMessage,
  TaskChannel,
} from "@posthog/shared/domain-types";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useMemo } from "react";

// Multiplayer, like the task feed: poll so a teammate's announcement appears
// without a dedicated push channel.
const CHANNEL_FEED_MESSAGES_POLL_INTERVAL_MS = 5_000;

// A rich "fake" message authored in the dev-only demo composer. Carried inside
// the feed message's freeform `payload` (the backend records the poster as the
// real author and offers no content field, so the shown persona + body ride the
// payload) and rendered as a full thread item — avatar, name, markdown body —
// rather than the plain announcement text.
export interface DemoFeedMessage {
  fromName: string;
  fromKind: "human" | "agent";
  /** Markdown; may embed links to canvases / other channels. */
  content: string;
}

// The `payload` key that marks a feed message as a demo composer post — the
// client keys rich rendering off it, ignoring the event's usual text. (Used for
// any server-side demo messages; the dev composer itself persists locally.)
export const DEMO_FEED_MARKER = "__demo";

function readDemoPayload(
  message: ChannelFeedMessage,
): DemoFeedMessage | undefined {
  const p = message.payload ?? {};
  if (p[DEMO_FEED_MARKER] !== true) return undefined;
  return {
    fromName: typeof p.from_name === "string" ? p.from_name : "Someone",
    fromKind: p.from_kind === "agent" ? "agent" : "human",
    content: typeof p.content === "string" ? p.content : message.content,
  };
}

// A channel-feed system message flattened to what the feed renders.
export interface ChannelFeedSystemMessage {
  id: string;
  /** ISO; interleaved with task cards in the feed. */
  createdAt: string;
  text: string;
  /** Present for dev-only demo composer posts; rendered as a rich thread item. */
  demo?: DemoFeedMessage;
}

export function channelFeedMessagesQueryKey(channelId: string | undefined) {
  return ["channel-feed-messages", channelId ?? "none"] as const;
}

// The "created this context" row is synthesized from the channel row itself
// (below) — the canonical creation record, available even where the feed
// endpoint isn't. Server-emitted channel_created (and its legacy client-posted
// context_created twin) would duplicate it, so both are dropped from the feed.
const CREATION_EVENTS = new Set(["channel_created", "context_created"]);

// Render the announcement from its event + structured payload (rename-safe),
// falling back to the freeform content.
function messageText(message: ChannelFeedMessage): string {
  const actor = userDisplayName(message.author ?? null);
  const contextName =
    typeof message.payload?.context_name === "string"
      ? message.payload.context_name
      : "";
  switch (message.event) {
    case "context_md_building":
      return `${actor} is building CONTEXT.md${contextName ? ` for ${contextName}` : ""}`;
    default:
      return message.content || `${actor} posted an update`;
  }
}

/**
 * The feed's "Ann created this context" opener, derived from the channel row
 * (creator + creation time) rather than a feed message: the channel predates
 * everything in its feed, so it always sorts first, and it renders even before
 * the feed-message endpoint is deployed. Personal channels are provisioned by
 * the system, so they get no creation row.
 */
export function channelCreationMessage(
  channel: TaskChannel | undefined,
): ChannelFeedSystemMessage | undefined {
  if (!channel || channel.channel_type !== "public") return undefined;
  return {
    id: `channel-created-${channel.id}`,
    createdAt: channel.created_at,
    text: `${userDisplayName(channel.created_by ?? null)} created this context`,
  };
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
      // The endpoint may not be deployed yet (posthog#70320): don't retry, and
      // stop polling once the query errors — otherwise every open channel view
      // streams 404s (poll tick × default retries) forever.
      retry: false,
      refetchInterval: (query) =>
        query.state.status === "error"
          ? false
          : CHANNEL_FEED_MESSAGES_POLL_INTERVAL_MS,
    },
  );
  const messages = useMemo(
    () =>
      (query.data ?? [])
        .filter((m) => !CREATION_EVENTS.has(m.event))
        .map((m) => {
          const demo = readDemoPayload(m);
          return {
            id: m.id,
            createdAt: m.created_at,
            text: demo?.content ?? messageText(m),
            demo,
          };
        }),
    [query.data],
  );
  return { messages, isLoading: query.isLoading };
}
