import type { DemoFeedMessage } from "@posthog/ui/features/canvas/hooks/useChannelFeedMessages";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// One locally-authored demo message. The channel-feed POST endpoint isn't
// deployed everywhere (posthog#70320), so the dev-only "insert fake message"
// tool persists here instead — client-side, keyed by the folder channelId, so
// the messages survive reloads and show in the feed on this machine. Not
// multiplayer; it's a demo prop, not a real post.
export interface DemoFeedEntry extends DemoFeedMessage {
  id: string;
  /** ISO; interleaved with tasks + real feed rows by timestamp. */
  createdAt: string;
}

interface DemoFeedState {
  byChannel: Record<string, DemoFeedEntry[]>;
  add: (channelId: string, entry: DemoFeedEntry) => void;
  remove: (channelId: string, id: string) => void;
}

export const useDemoFeedStore = create<DemoFeedState>()(
  persist(
    (set) => ({
      byChannel: {},
      add: (channelId, entry) =>
        set((state) => ({
          byChannel: {
            ...state.byChannel,
            [channelId]: [...(state.byChannel[channelId] ?? []), entry],
          },
        })),
      remove: (channelId, id) =>
        set((state) => ({
          byChannel: {
            ...state.byChannel,
            [channelId]: (state.byChannel[channelId] ?? []).filter(
              (e) => e.id !== id,
            ),
          },
        })),
    }),
    { name: "demo-feed-messages" },
  ),
);
