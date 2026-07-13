import { Lightning } from "@phosphor-icons/react";
import { ChatMarker, ChatMarkerContent } from "@posthog/quill";
import { Badge, Box, Flex, Text } from "@radix-ui/themes";
import { useChatThreadChrome } from "../chat-thread/chatThreadChrome";

interface CompactBoundaryViewProps {
  // Both optional — the codex adapter reports a boundary without metadata.
  trigger?: "manual" | "auto";
  preTokens?: number;
  contextSize?: number;
}

export function CompactBoundaryView({
  trigger,
  preTokens,
  contextSize,
}: CompactBoundaryViewProps) {
  const hasTokens = typeof preTokens === "number" && Number.isFinite(preTokens);
  const tokensK = hasTokens ? Math.round(preTokens / 1000) : null;
  const percent =
    hasTokens && contextSize && contextSize > 0
      ? Math.round((preTokens / contextSize) * 100)
      : null;
  // New thread renders the boundary as a centered separator marker; the legacy thread keeps its
  // bordered badge row so ConversationView is unchanged when the chat thread is off.
  const chatChrome = useChatThreadChrome();

  if (chatChrome) {
    const markerParts = ["Conversation compacted"];
    if (trigger) markerParts.push(trigger);
    if (percent !== null) markerParts.push(`${percent}% of context`);
    else if (tokensK !== null) markerParts.push(`~${tokensK}K tokens`);
    return (
      <ChatMarker variant="separator">
        <ChatMarkerContent>{markerParts.join(" · ")}</ChatMarkerContent>
      </ChatMarker>
    );
  }

  return (
    <Box className="my-1 border-blue-6 border-l-2 py-1 pl-3 dark:border-blue-8">
      <Flex align="center" gap="2">
        <Lightning size={14} weight="fill" className="text-blue-9" />
        <Text className="text-[13px] text-gray-11">Conversation compacted</Text>
        {trigger && (
          <Badge
            size="1"
            color={trigger === "auto" ? "orange" : "blue"}
            variant="soft"
          >
            {trigger}
          </Badge>
        )}
        {tokensK !== null && (
          <Text className="text-[13px] text-gray-9">
            {percent !== null
              ? `(${percent}% of context · ~${tokensK}K tokens summarized)`
              : `(~${tokensK}K tokens summarized)`}
          </Text>
        )}
      </Flex>
    </Box>
  );
}
