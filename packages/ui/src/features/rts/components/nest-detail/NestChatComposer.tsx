import { PaperPlaneRight } from "@phosphor-icons/react";
import { useFunSpeak } from "@posthog/ui/features/fun-mode/hooks/useFunSpeak";
import { Flex, IconButton, Text, TextField } from "@radix-ui/themes";
import type { KeyboardEvent } from "react";

interface NestChatComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  sending: boolean;
  error: string | null;
}

export function NestChatComposer({
  draft,
  onDraftChange,
  onSend,
  onKeyDown,
  sending,
  error,
}: NestChatComposerProps) {
  const t = useFunSpeak();
  return (
    <div className="flex flex-col gap-2 border-(--accent-a5) border-t bg-(--gray-a2) px-3 py-2">
      <Flex gap="2" align="center">
        <TextField.Root
          placeholder={t("Message the hedgehog…")}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
          className="flex-1"
        />
        <IconButton
          onClick={onSend}
          disabled={!draft.trim() || sending}
          loading={sending}
          size="2"
          variant="soft"
          aria-label="Send message"
        >
          <PaperPlaneRight size={14} />
        </IconButton>
      </Flex>
      {error && (
        <Text size="1" color="red">
          {error}
        </Text>
      )}
    </div>
  );
}
