import { useFunSpeak } from "@posthog/ui/features/fun-mode/hooks/useFunSpeak";
import { Flex, Text } from "@radix-ui/themes";
import { type RefObject, useEffect, useRef } from "react";
import {
  selectNestMessages,
  useNestChatStore,
} from "../../stores/nestChatStore";
import { NestChatMessage } from "./NestChatMessage";

interface NestChatMessagesProps {
  nestId: string;
  bottomRef?: RefObject<HTMLDivElement | null>;
}

export function NestChatMessages({ nestId, bottomRef }: NestChatMessagesProps) {
  const t = useFunSpeak();
  const messages = useNestChatStore(selectNestMessages(nestId));
  const loadingMessages = useNestChatStore(
    (s) => s.loadingByNestId[nestId] ?? false,
  );
  const fallbackRef = useRef<HTMLDivElement>(null);
  const ref = bottomRef ?? fallbackRef;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on nest open and once messages finish loading
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: "end" });
    });
    return () => cancelAnimationFrame(raf);
  }, [nestId, loadingMessages, messages.length]);

  return (
    <>
      <div className="border-(--accent-a5) border-t pt-3">
        <Flex direction="column" gap="2">
          <Text
            size="1"
            weight="medium"
            className="font-mono text-(--accent-11) uppercase tracking-[0.18em]"
          >
            {t("Nest chat")}
          </Text>
          {loadingMessages && messages.length === 0 ? (
            <Text size="2" color="gray">
              Loading context...
            </Text>
          ) : messages.length === 0 ? (
            <Text size="2" color="gray">
              {t("No messages yet — talk to the hedgehog below.")}
            </Text>
          ) : (
            messages.map((message) => (
              <NestChatMessage key={message.id} message={message} />
            ))
          )}
        </Flex>
      </div>
      <div ref={ref} />
    </>
  );
}
