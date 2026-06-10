import { useHostTRPCClient } from "@posthog/host-router/react";
import { logger } from "@posthog/ui/shell/logger";
import { type KeyboardEvent, useEffect, useState } from "react";
import { loadNestChatMessages } from "../../service/nestChatService";

const log = logger.scope("nest-detail-panel");

export interface UseNestChatResult {
  draft: string;
  setDraft: (value: string) => void;
  sending: boolean;
  error: string | null;
  send: () => Promise<void>;
  handleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export function useNestChat(nestId: string): UseNestChatResult {
  const [draft, setDraft] = useState("");
  const hostClient = useHostTRPCClient();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft("");
    setError(null);
    void loadNestChatMessages(nestId);
  }, [nestId]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await hostClient.rts.nestChat.send.mutate({ nestId, body });
      setDraft("");
    } catch (e) {
      log.error("Failed to send nest chat", { nestId, error: e });
      setError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return { draft, setDraft, sending, error, send, handleKeyDown };
}
