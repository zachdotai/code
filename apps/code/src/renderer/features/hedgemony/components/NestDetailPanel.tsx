import type {
  Nest,
  NestMessage,
  NestMessageKind,
} from "@main/services/hedgemony/schemas";
import {
  Archive,
  ChatCircle,
  FloppyDisk,
  PaperPlaneRight,
  Warning,
  X,
} from "@phosphor-icons/react";
import {
  Button,
  Flex,
  ScrollArea,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { selectNestMessages, useNestChatStore } from "../stores/nestChatStore";
import { selectHedgehogState, useNestStore } from "../stores/nestStore";

const log = logger.scope("nest-detail-panel");

interface NestDetailPanelProps {
  nest: Nest;
  onClose: () => void;
  onRelocate?: () => void;
}

export function NestDetailPanel({
  nest,
  onClose,
  onRelocate,
}: NestDetailPanelProps) {
  const [name, setName] = useState(nest.name);
  const [goalPrompt, setGoalPrompt] = useState(nest.goalPrompt);
  const [definitionOfDone, setDefinitionOfDone] = useState(
    nest.definitionOfDone ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messages = useNestChatStore(selectNestMessages(nest.id));
  const loadingMessages = useNestChatStore(
    (s) => s.loadingByNestId[nest.id] ?? false,
  );
  const loadMessages = useNestChatStore((s) => s.load);
  const hedgehogState = useNestStore(selectHedgehogState(nest.id));

  const [chatDraft, setChatDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  useEffect(() => {
    setName(nest.name);
    setGoalPrompt(nest.goalPrompt);
    setDefinitionOfDone(nest.definitionOfDone ?? "");
    setError(null);
    setChatDraft("");
    setChatError(null);
    void loadMessages(nest.id);
  }, [nest, loadMessages]);

  const handleSendChat = async () => {
    const body = chatDraft.trim();
    if (!body || sending) return;
    setSending(true);
    setChatError(null);
    try {
      await trpcClient.hedgemony.nestChat.send.mutate({
        nestId: nest.id,
        body,
      });
      setChatDraft("");
    } catch (e) {
      log.error("Failed to send nest chat", { nestId: nest.id, error: e });
      setChatError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleChatKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSendChat();
    }
  };

  const canSave = name.trim().length > 0 && goalPrompt.trim().length > 0;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await trpcClient.hedgemony.nests.update.mutate({
        id: nest.id,
        name: name.trim(),
        goalPrompt: goalPrompt.trim(),
        definitionOfDone: definitionOfDone.trim() || null,
      });
      useNestStore.getState().upsert(updated);
    } catch (e) {
      log.error("Failed to update nest", { id: nest.id, error: e });
      setError(e instanceof Error ? e.message : "Failed to update nest");
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (archiving) return;
    setArchiving(true);
    setError(null);
    try {
      const archived = await trpcClient.hedgemony.nests.archive.mutate({
        id: nest.id,
      });
      useNestStore.getState().remove(archived.id);
      onClose();
    } catch (e) {
      log.error("Failed to archive nest", { id: nest.id, error: e });
      setError(e instanceof Error ? e.message : "Failed to archive nest");
      setArchiving(false);
    }
  };

  return (
    <aside className="absolute top-3 right-3 bottom-3 z-10 flex w-[360px] min-w-0 flex-col rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) shadow-xl">
      <div className="flex items-start justify-between gap-3 border-(--gray-5) border-b px-4 py-3">
        <div className="min-w-0">
          <Text size="1" color="gray" className="block">
            Nest
          </Text>
          <Text size="3" weight="bold" className="block truncate">
            {nest.name}
          </Text>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-2) text-(--gray-10) hover:bg-(--gray-3) hover:text-(--gray-12)"
          title="Close"
        >
          <X size={15} />
        </button>
      </div>

      <ScrollArea type="auto" scrollbars="vertical" className="min-h-0 flex-1">
        <Flex direction="column" gap="4" p="4">
          <Flex direction="column" gap="3">
            <LabeledField label="Name" htmlFor="nest-detail-name">
              <TextField.Root
                id="nest-detail-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving || archiving}
              />
            </LabeledField>

            <LabeledField label="Goal" htmlFor="nest-detail-goal">
              <TextArea
                id="nest-detail-goal"
                value={goalPrompt}
                onChange={(e) => setGoalPrompt(e.target.value)}
                rows={5}
                disabled={saving || archiving}
              />
            </LabeledField>

            <LabeledField
              label="Definition of done"
              htmlFor="nest-detail-definition"
            >
              <TextArea
                id="nest-detail-definition"
                value={definitionOfDone}
                onChange={(e) => setDefinitionOfDone(e.target.value)}
                rows={4}
                disabled={saving || archiving}
              />
            </LabeledField>
          </Flex>

          {error && (
            <Text size="2" color="red">
              {error}
            </Text>
          )}

          <Flex gap="2">
            <Button
              onClick={handleSave}
              disabled={!canSave || saving || archiving}
              loading={saving}
            >
              <FloppyDisk size={14} />
              Save
            </Button>
            {onRelocate && (
              <Button
                variant="soft"
                color="gray"
                onClick={onRelocate}
                disabled={saving || archiving}
              >
                Relocate
              </Button>
            )}
            <Button
              variant="soft"
              color="red"
              onClick={handleArchive}
              disabled={saving || archiving}
              loading={archiving}
            >
              <Archive size={14} />
              Archive
            </Button>
          </Flex>

          <div className="border-(--gray-5) border-t pt-4">
            <Flex direction="column" gap="2">
              <div className="flex items-center justify-between">
                <Text size="2" weight="medium">
                  Nest chat
                </Text>
                {hedgehogState?.state === "ticking" && (
                  <span className="flex items-center gap-1 rounded-full bg-(--amber-3) px-2 py-0.5 text-(--amber-11) text-[11px]">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-(--amber-9)" />
                    Hedgehog ticking…
                  </span>
                )}
              </div>
              {loadingMessages && messages.length === 0 ? (
                <Text size="2" color="gray">
                  Loading context...
                </Text>
              ) : messages.length === 0 ? (
                <Text size="2" color="gray">
                  No messages yet — talk to the hedgehog below.
                </Text>
              ) : (
                messages.map((message) => (
                  <NestChatMessage key={message.id} message={message} />
                ))
              )}
            </Flex>
          </div>
        </Flex>
      </ScrollArea>

      <div className="border-(--gray-5) border-t bg-(--gray-1) p-3">
        <Flex direction="column" gap="2">
          <TextField.Root
            placeholder="Message the hedgehog…"
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            onKeyDown={handleChatKeyDown}
            disabled={sending}
          />
          {chatError && (
            <Text size="1" color="red">
              {chatError}
            </Text>
          )}
          <Flex justify="end">
            <Button
              onClick={handleSendChat}
              disabled={!chatDraft.trim() || sending}
              loading={sending}
              size="2"
            >
              <PaperPlaneRight size={14} />
              Send
            </Button>
          </Flex>
        </Flex>
      </div>
    </aside>
  );
}

const KIND_LABEL: Record<NestMessageKind, string> = {
  user_message: "You",
  hedgehog_message: "Hedgehog",
  audit: "Audit",
  tool_result: "Tool result",
  hoglet_summary: "Hoglet",
};

const KIND_ACCENT: Record<NestMessageKind, string> = {
  user_message: "text-(--gray-12)",
  hedgehog_message: "text-(--amber-11)",
  audit: "text-(--gray-10)",
  tool_result: "text-(--blue-11)",
  hoglet_summary: "text-(--gray-11)",
};

interface FeedbackRoutedPayload {
  type: "feedback_routed";
  source: "pr_review" | "ci" | "issue";
  outcome: "injected" | "follow_up_spawned" | "failed";
  payloadRef: string;
  hogletTaskId: string;
}

function parseFeedbackRoutedPayload(
  payloadJson: string | null,
): FeedbackRoutedPayload | null {
  if (!payloadJson) return null;
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    if (parsed.type !== "feedback_routed") return null;
    return parsed as unknown as FeedbackRoutedPayload;
  } catch {
    return null;
  }
}

function NestChatMessage({ message }: { message: NestMessage }) {
  const routed = parseFeedbackRoutedPayload(message.payloadJson);
  if (routed) {
    return <FeedbackRoutedMessage message={message} payload={routed} />;
  }
  const label = KIND_LABEL[message.kind] ?? message.kind;
  const accent = KIND_ACCENT[message.kind] ?? "text-(--gray-11)";
  return (
    <div className="rounded-(--radius-2) border border-(--gray-4) bg-(--gray-2) p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Text size="1" weight="medium" className={accent}>
          {label}
        </Text>
        <Text size="1" color="gray">
          {new Date(message.createdAt).toLocaleString()}
        </Text>
      </div>
      <Text as="p" size="2" className="whitespace-pre-wrap text-(--gray-12)">
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
  const label =
    payload.source === "pr_review" ? "Feedback routed" : "CI failure routed";
  return (
    <div className={`rounded-(--radius-2) border ${tone} p-2`}>
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
      <Text as="p" size="2" className="whitespace-pre-wrap text-(--gray-12)">
        {message.body}
      </Text>
    </div>
  );
}

function LabeledField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Text
        as="label"
        htmlFor={htmlFor}
        size="2"
        mb="1"
        weight="medium"
        className="block"
      >
        {label}
      </Text>
      {children}
    </div>
  );
}
