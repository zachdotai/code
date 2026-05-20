import { MarkdownRenderer } from "@features/editor/components/MarkdownRenderer";
import { sendPromptToAgent } from "@features/sessions/utils/sendPromptToAgent";
import { CheckCircle, Robot, User, X } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Avatar, Badge, Box, Flex, Text } from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { isSendMessageSubmitKey } from "@utils/sendMessageKey";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  buildAskAgentToIncorporateResolvedThreadPrompt,
  buildAskAgentToReplyToPlanThreadPrompt,
} from "../utils/planPrompts";

const log = logger.scope("plan-thread");

interface ParsedMessage {
  speaker: "H" | "A";
  text: string;
}

interface PlanThreadProps {
  filePath: string;
  taskId: string;
  blockText: string;
  messages: ParsedMessage[];
  resolved: boolean;
}

function MessageRow({
  message,
  showLineAbove,
  showLineBelow,
}: {
  message: ParsedMessage;
  showLineAbove: boolean;
  showLineBelow: boolean;
}) {
  const isAgent = message.speaker === "A";
  return (
    <div className="flex gap-2">
      <div className="flex flex-col items-center">
        {showLineAbove ? (
          <div className="h-1.5 w-0.5 rounded-full bg-(--gray-5)" />
        ) : (
          <div className="h-1.5" />
        )}
        <Avatar
          size="1"
          radius="full"
          fallback={isAgent ? <Robot size={12} /> : <User size={12} />}
          className="shrink-0"
          color={isAgent ? "blue" : "gray"}
        />
        {showLineBelow && (
          <div className="w-0.5 flex-1 rounded-full bg-(--gray-5)" />
        )}
      </div>
      <div className="min-w-0 flex-1 pt-1 pb-1.5">
        <Flex align="center" gap="2" className="mb-0.5">
          <Text className="font-medium text-(--gray-12) text-[13px]">
            {isAgent ? "Agent" : "You"}
          </Text>
        </Flex>
        <Box className="break-words text-(--gray-11) text-[13px] leading-relaxed [&_p]:m-0">
          <MarkdownRenderer content={message.text} />
        </Box>
      </div>
    </div>
  );
}

export function PlanThread({
  filePath,
  taskId,
  blockText,
  messages,
  resolved,
}: PlanThreadProps) {
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleReplySubmit = useCallback(async () => {
    const text = textareaRef.current?.value?.trim();
    if (!text) return;
    setPending(text);
    setShowReplyBox(false);
    try {
      await trpcClient.plans.appendThreadMessage.mutate({
        filePath,
        blockText,
        message: text,
        speaker: "H",
      });
      sendPromptToAgent(
        taskId,
        buildAskAgentToReplyToPlanThreadPrompt(filePath, blockText),
      );
    } catch (err) {
      log.warn("Failed to append plan thread reply", { err });
    } finally {
      setPending(null);
    }
  }, [blockText, filePath, taskId]);

  const handleResolve = useCallback(async () => {
    try {
      await trpcClient.plans.resolveThread.mutate({ filePath, blockText });
      sendPromptToAgent(
        taskId,
        buildAskAgentToIncorporateResolvedThreadPrompt(filePath),
      );
    } catch (err) {
      log.warn("Failed to resolve plan thread", { err });
    }
  }, [blockText, filePath, taskId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isSendMessageSubmitKey(e)) {
        e.preventDefault();
        handleReplySubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowReplyBox(false);
      }
    },
    [handleReplySubmit],
  );

  const setTextareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    if (el) requestAnimationFrame(() => el.focus());
  }, []);

  const renderedMessages = useMemo(() => messages, [messages]);

  return (
    <div className="my-2 ml-6">
      <div className="overflow-hidden rounded-md border border-(--gray-5) bg-(--gray-2) px-2.5 py-2 font-sans">
        {resolved && (
          <Flex align="center" gap="1" className="mb-1.5">
            <Badge color="green" size="1" variant="soft">
              <CheckCircle size={12} weight="fill" />
              Resolved
            </Badge>
          </Flex>
        )}

        {renderedMessages.map((message, index) => (
          <MessageRow
            key={`${message.speaker}-${index}`}
            message={message}
            showLineAbove={index > 0}
            showLineBelow={index < renderedMessages.length - 1 || !!pending}
          />
        ))}

        {pending && (
          <div className="flex gap-2 opacity-50">
            <div className="flex flex-col items-center">
              <div className="h-1.5 w-0.5 rounded-full bg-(--gray-5)" />
              <Avatar
                size="1"
                radius="full"
                fallback={<User size={12} />}
                className="shrink-0"
              />
            </div>
            <div className="min-w-0 flex-1 pt-1 pb-1.5">
              <Text className="font-medium text-(--gray-12) text-[13px]">
                Sending…
              </Text>
              <Box className="break-words text-(--gray-11) text-[13px] leading-relaxed [&_p]:m-0">
                <MarkdownRenderer content={pending} />
              </Box>
            </div>
          </div>
        )}

        {!resolved &&
          (showReplyBox ? (
            <div className="mt-1.5 border-(--gray-4) border-t pt-1.5">
              <textarea
                ref={setTextareaRef}
                placeholder="Write a reply…"
                onKeyDown={handleKeyDown}
                className="min-h-[48px] w-full resize-none rounded border border-(--gray-6) bg-(--color-background) p-1.5 text-(--gray-12) text-[13px] leading-normal outline-none"
              />
              <Flex align="center" gap="2" className="mt-1.5">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleReplySubmit}
                  disabled={!!pending}
                >
                  {pending ? "Sending…" : "Reply"}
                </Button>
                <Button size="icon-sm" onClick={() => setShowReplyBox(false)}>
                  <X />
                </Button>
              </Flex>
            </div>
          ) : (
            <Flex
              align="center"
              gap="1"
              className="mt-1 border-(--gray-4) border-t pt-1.5"
            >
              <Button size="sm" onClick={() => setShowReplyBox(true)}>
                Reply
              </Button>
              <Button size="sm" onClick={handleResolve}>
                <CheckCircle />
                Resolve
              </Button>
            </Flex>
          ))}
      </div>
    </div>
  );
}
