import type { NestMessage } from "@main/services/hedgemony/schemas";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { create } from "zustand";

const log = logger.scope("nest-chat-store");

interface NestChatStoreState {
  messagesByNestId: Record<string, NestMessage[]>;
  loadingByNestId: Record<string, boolean>;
}

interface NestChatStoreActions {
  setMessages: (nestId: string, messages: NestMessage[]) => void;
  setLoading: (nestId: string, loading: boolean) => void;
  load: (nestId: string) => Promise<void>;
  /**
   * Append a message coming in from a live `message_appended` event.
   * Idempotent on `id` so re-deliveries are safe.
   */
  append: (nestId: string, message: NestMessage) => void;
}

type NestChatStore = NestChatStoreState & NestChatStoreActions;

export const useNestChatStore = create<NestChatStore>()((set, get) => ({
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

  load: async (nestId) => {
    get().setLoading(nestId, true);
    try {
      const messages = await trpcClient.hedgemony.nestChat.list.query({
        nestId,
      });
      get().setMessages(nestId, messages);
    } catch (error) {
      log.error("Failed to load nest chat", { nestId, error });
    } finally {
      get().setLoading(nestId, false);
    }
  },

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
