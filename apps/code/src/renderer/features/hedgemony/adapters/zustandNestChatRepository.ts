import type { NestChatRepository } from "../domain/NestChatRepository";
import { useNestChatStore } from "../stores/nestChatStore";

export const zustandNestChatRepository: NestChatRepository = {
  append(nestId, message) {
    useNestChatStore.getState().append(nestId, message);
  },
};
