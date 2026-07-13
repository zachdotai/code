import { Lightning } from "@phosphor-icons/react";
import { ChatMarker, ChatMarkerContent } from "@posthog/quill";
import { Badge, Box, Flex, Text } from "@radix-ui/themes";
import { formatTokensCompact } from "../../contextColors";
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
  const tokens =
    typeof preTokens === "number" && preTokens > 0 ? preTokens : null;
  const percent =
    tokens !== null && contextSize && contextSize > 0
      ? Math.round((tokens / contextSize) * 100)
      : null;
  const detail =
    tokens !== null
      ? percent !== null
        ? `${percent}% of context · ~${formatTokensCompact(tokens)} tokens`
        : `~${formatTokensCompact(tokens)} tokens`
      : null;
  // New thread renders the boundary as a centered separator marker; the legacy thread keeps its
  // bordered badge row so ConversationView is unchanged when the chat thread is off.
  const chatChrome = useChatThreadChrome();

  if (chatChrome) {
    return (
      <ChatMarker variant="separator">
        <ChatMarkerContent>
          {["Conversation compacted", trigger, detail]
            .filter(Boolean)
            .join(" · ")}
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
        {detail ? (
          <Text className="text-[13px] text-gray-9">({detail} summarized)</Text>
        ) : null}
      </Flex>
    </Box>
  );
}
