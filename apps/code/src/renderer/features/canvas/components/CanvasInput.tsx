import { DotPatternBackground } from "@components/DotPatternBackground";
import { PromptInput } from "@features/message-editor/components/PromptInput";
import type { EditorHandle } from "@features/message-editor/types";
import { Button, Flex, Heading, Text } from "@radix-ui/themes";
import { logger } from "@utils/logger";
import { toast } from "@utils/toast";
import { useCallback, useRef } from "react";

const log = logger.scope("canvas-input");

interface CanvasInputProps {
  canvasId: string;
}

export function CanvasInput({ canvasId }: CanvasInputProps) {
  const editorRef = useRef<EditorHandle>(null);
  const sessionId = `canvas-input:${canvasId}`;

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      log.info("Canvas requested", { canvasId, prompt: trimmed });
      toast.info("Canvas creation coming soon", trimmed);
      editorRef.current?.clear();
    },
    [canvasId],
  );

  const handleGuess = useCallback(() => {
    const prompt = `Generate a canvas based on existing PostHog data`;
    log.info("Canvas guess requested", { canvasId, prompt });
    toast.info("Canvas creation coming soon", prompt);
  }, [canvasId]);

  return (
    <Flex
      align="center"
      justify="center"
      height="100%"
      className="relative px-4"
    >
      <DotPatternBackground className="h-[100.333%]" />
      <Flex
        direction="column"
        gap="3"
        className="relative z-[1] w-full max-w-[600px]"
      >
        <Flex direction="column" gap="1">
          <Heading size="4" className="text-(--gray-12)">
            Create a canvas
          </Heading>
          <Text size="2" color="gray">
            Use AI to generate a view of PostHog data — charts, related flags,
            experiments, and more.
          </Text>
        </Flex>

        <PromptInput
          ref={editorRef}
          sessionId={sessionId}
          placeholder="What should this canvas show?"
          editorHeight="large"
          autoFocus
          clearOnSubmit={false}
          onSubmit={handleSubmit}
        />

        <Flex justify="end">
          <Button variant="soft" size="2" onClick={handleGuess}>
            Guess what to show
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}
