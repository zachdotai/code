import { PromptInput } from "@features/message-editor/components/PromptInput";
import type { EditorHandle } from "@features/message-editor/types";
import { CHAT_CONTENT_MAX_WIDTH } from "@features/sessions/constants";
import { Box } from "@radix-ui/themes";
import { logger } from "@utils/logger";
import { toast } from "@utils/toast";
import { useCallback, useRef } from "react";

const log = logger.scope("canvas-chat");

interface CanvasChatBoxProps {
  canvasId: string;
}

export function CanvasChatBox({ canvasId }: CanvasChatBoxProps) {
  const editorRef = useRef<EditorHandle>(null);
  const sessionId = `canvas-chat:${canvasId}`;

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      log.info("Canvas chat submitted", { canvasId, prompt: trimmed });
      toast.info("Canvas chat coming soon", trimmed);
      editorRef.current?.clear();
    },
    [canvasId],
  );

  return (
    <Box className="relative border-(--gray-4) border-t">
      <Box className="mx-auto p-2" style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}>
        <PromptInput
          ref={editorRef}
          sessionId={sessionId}
          placeholder="Ask a question or change this canvas... (this should prob be a sidebar since chat gets tall)"
          onSubmit={handleSubmit}
        />
      </Box>
    </Box>
  );
}
