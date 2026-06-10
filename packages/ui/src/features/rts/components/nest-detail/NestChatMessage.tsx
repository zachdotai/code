import { ChatCircle, GitMerge, Warning } from "@phosphor-icons/react";
import type {
  NestMessage,
  NestMessageKind,
} from "@posthog/host-router/rts-schemas";
import { Flex, Text } from "@radix-ui/themes";
import {
  type FeedbackRoutedPayload,
  type PrGraphRoutedPayload,
  parseFeedbackRoutedPayload,
  parsePrGraphRoutedPayload,
} from "../nest-payload-schemas";

const KIND_LABEL: Record<NestMessageKind, string> = {
  user_message: "You",
  hedgehog_message: "Hedgehog",
  audit: "Audit",
  tool_result: "Tool result",
  hoglet_summary: "Hoglet",
  hoglet_message: "Hoglet",
};

const KIND_ACCENT: Record<NestMessageKind, string> = {
  user_message: "text-(--gray-12)",
  hedgehog_message: "text-(--amber-11)",
  audit: "text-(--gray-10)",
  tool_result: "text-(--blue-11)",
  hoglet_summary: "text-(--gray-11)",
  hoglet_message: "text-(--gray-11)",
};

const MESSAGE_BODY_CLASS =
  "min-w-0 whitespace-pre-wrap break-words text-(--gray-12) [overflow-wrap:anywhere]";

export function NestChatMessage({ message }: { message: NestMessage }) {
  const routed = parseFeedbackRoutedPayload(message.payloadJson);
  if (routed) {
    return <FeedbackRoutedMessage message={message} payload={routed} />;
  }
  const rebase = parsePrGraphRoutedPayload(message.payloadJson);
  if (rebase) {
    return <PrGraphRebasedMessage message={message} payload={rebase} />;
  }
  const label = KIND_LABEL[message.kind] ?? message.kind;
  const accent = KIND_ACCENT[message.kind] ?? "text-(--gray-11)";
  return (
    <div className="min-w-0 rounded-(--radius-2) border border-(--gray-4) bg-(--gray-a2) p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Text size="1" weight="medium" className={accent}>
          {label}
        </Text>
        <Text size="1" color="gray">
          {new Date(message.createdAt).toLocaleString()}
        </Text>
      </div>
      <Text as="p" size="2" className={MESSAGE_BODY_CLASS}>
        {message.body}
      </Text>
    </div>
  );
}

function PrGraphRebasedMessage({
  message,
  payload,
}: {
  message: NestMessage;
  payload: PrGraphRoutedPayload;
}) {
  const tone =
    payload.outcome === "broken" || payload.outcome === "failed"
      ? "border-(--red-6) bg-(--red-2) text-(--red-11)"
      : payload.outcome === "injected"
        ? "border-(--green-6) bg-(--green-2) text-(--green-11)"
        : "border-(--purple-6) bg-(--purple-2) text-(--purple-11)";
  return (
    <div className={`min-w-0 rounded-(--radius-2) border ${tone} p-2`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <Flex align="center" gap="1">
          <GitMerge size={12} weight="bold" />
          <Text size="1" weight="medium">
            PR rebase routed
          </Text>
        </Flex>
        <Text size="1" color="gray">
          {new Date(message.createdAt).toLocaleString()}
        </Text>
      </div>
      <Text as="p" size="2" className={MESSAGE_BODY_CLASS}>
        {message.body}
      </Text>
    </div>
  );
}

function FeedbackRoutedMessage({
  message,
  payload,
}: {
  message: NestMessage;
  payload: FeedbackRoutedPayload;
}) {
  const Icon = payload.source === "ci" ? Warning : ChatCircle;
  const tone =
    payload.outcome === "failed"
      ? "border-(--orange-6) bg-(--orange-2) text-(--orange-11)"
      : "border-(--cyan-6) bg-(--cyan-2) text-(--cyan-11)";
  const sourceLabels: Record<FeedbackRoutedPayload["source"], string> = {
    pr_review: "Feedback routed",
    ci: "CI failure routed",
    issue: "Issue feedback routed",
    hedgehog: "Hedgehog message routed",
  };
  const label = sourceLabels[payload.source];
  return (
    <div className={`min-w-0 rounded-(--radius-2) border ${tone} p-2`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <Flex align="center" gap="1">
          <Icon size={12} weight="bold" />
          <Text size="1" weight="medium">
            {label}
          </Text>
        </Flex>
        <Text size="1" color="gray">
          {new Date(message.createdAt).toLocaleString()}
        </Text>
      </div>
      <Text as="p" size="2" className={MESSAGE_BODY_CLASS}>
        {message.body}
      </Text>
    </div>
  );
}
