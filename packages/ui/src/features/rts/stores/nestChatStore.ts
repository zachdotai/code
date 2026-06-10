import type { NestMessage } from "@posthog/host-router/rts-schemas";
import { create } from "zustand";

interface NestChatStoreState {
  messagesByNestId: Record<string, NestMessage[]>;
  loadingByNestId: Record<string, boolean>;
}

interface NestChatStoreActions {
  setMessages: (nestId: string, messages: NestMessage[]) => void;
  setLoading: (nestId: string, loading: boolean) => void;
  /**
   * Append a message coming in from a live `message_appended` event.
   * Idempotent on `id` so re-deliveries are safe.
   */
  append: (nestId: string, message: NestMessage) => void;
}

type NestChatStore = NestChatStoreState & NestChatStoreActions;

export const useNestChatStore = create<NestChatStore>()((set) => ({
  messagesByNestId: {},
  loadingByNestId: {},

  setMessages: (nestId, messages) =>
    set((state) => ({
      messagesByNestId: { ...state.messagesByNestId, [nestId]: messages },
    })),

  setLoading: (nestId, loading) =>
    set((state) => ({
      loadingByNestId: { ...state.loadingByNestId, [nestId]: loading },
    })),

  append: (nestId, message) =>
    set((state) => {
      const existing = state.messagesByNestId[nestId] ?? [];
      if (existing.some((m) => m.id === message.id)) {
        return state;
      }
      return {
        messagesByNestId: {
          ...state.messagesByNestId,
          [nestId]: [...existing, message],
        },
      };
    }),
}));

export const selectNestMessages =
  (nestId: string | null) =>
  (state: NestChatStore): NestMessage[] =>
    nestId ? (state.messagesByNestId[nestId] ?? []) : [];
