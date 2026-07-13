import { Lightning } from "@phosphor-icons/react";
import { ChatMarker, ChatMarkerContent } from "@posthog/quill";
import { Badge, Box, Flex, Text } from "@radix-ui/themes";
import { useChatThreadChrome } from "../chat-thread/chatThreadChrome";

interface CompactBoundaryViewProps {
  trigger?: "manual" | "auto";
  preTokens?: number;
  contextSize?: number;
}

export function CompactBoundaryView({
  trigger,
  preTokens,
  contextSize,
}: CompactBoundaryViewProps) {
  const validTokens =
    typeof preTokens === "number" &&
    Number.isFinite(preTokens) &&
    preTokens > 0
      ? preTokens
      : null;
  const tokensK = validTokens !== null ? Math.round(validTokens / 1000) : null;
  const percent =
    validTokens !== null && contextSize && contextSize > 0
      ? Math.round((validTokens / contextSize) * 100)
      : null;
  // New thread renders the boundary as a centered separator marker; the legacy thread keeps its
  // bordered badge row so ConversationView is unchanged when the chat thread is off.
  const chatChrome = useChatThreadChrome();

  const detail =
    percent !== null
      ? `${percent}% of context`
      : tokensK !== null
        ? `~${tokensK}K tokens`
        : null;

  if (chatChrome) {
    return (
      <ChatMarker variant="separator">
        <ChatMarkerContent>
          {`Conversation compacted${trigger ? ` · ${trigger}` : ""}${
            detail ? ` · ${detail}` : ""
          }`}
        </ChatMarkerContent>
      </ChatMarker>
    );
  }

  return (
    <Box className="my-1 border-blue-6 border-l-2 py-1 pl-3 dark:border-blue-8">
      <Flex align="center" gap="2">
        <Lightning size={14} weight="fill" className="text-blue-9" />
        <Text className="text-[13px] text-gray-11">Conversation compacted</Text>
        {trigger ? (
          <Badge
            size="1"
            color={trigger === "auto" ? "orange" : "blue"}
            variant="soft"
          >
            {trigger}
          </Badge>
        ) : null}
        {tokensK !== null ? (
          <Text className="text-[13px] text-gray-9">
            {percent !== null
              ? `(${percent}% of context · ~${tokensK}K tokens summarized)`
              : `(~${tokensK}K tokens summarized)`}
          </Text>
        ) : null}
      </Flex>
    </Box>
  );
}
