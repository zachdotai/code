import { logger } from "@posthog/ui/shell/logger";
import { hostClient } from "../hostClient";
import { useNestChatStore } from "../stores/nestChatStore";

const log = logger.scope("nest-chat-service");

export async function loadNestChatMessages(nestId: string): Promise<void> {
  const store = useNestChatStore.getState();
  store.setLoading(nestId, true);
  try {
    const messages = await hostClient().rts.nestChat.list.query({
      nestId,
    });
    useNestChatStore.getState().setMessages(nestId, messages);
  } catch (error) {
    log.error("Failed to load nest chat", { nestId, error });
  } finally {
    useNestChatStore.getState().setLoading(nestId, false);
  }
}
