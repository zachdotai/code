import { KeyHint } from "@components/ui/KeyHint";
import { useFunSpeak } from "@features/fun-mode/hooks/useFunSpeak";
import type {
  Hoglet,
  Nest,
  NestMessage,
  NestMessageKind,
  PrDependencyView,
} from "@main/services/rts/schemas";
import {
  Archive,
  ArrowsClockwise,
  ArrowsOutCardinal,
  ChatCircle,
  CheckCircle,
  Crosshair,
  FloppyDisk,
  GitMerge,
  PaperPlaneRight,
  SignOut,
  Sparkle,
  Trash,
  Warning,
  X,
} from "@phosphor-icons/react";
import {
  AlertDialog,
  Badge,
  Button,
  Flex,
  IconButton,
  ScrollArea,
  Text,
  TextArea,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { releaseHoglet } from "../service/hogletMutations";
import { loadNestChatMessages } from "../service/nestChatService";
import {
  selectNestHoglets,
  selectTaskSummary,
  useHogletStore,
} from "../stores/hogletStore";
import { selectNestMessages, useNestChatStore } from "../stores/nestChatStore";
import { selectHedgehogState, useNestStore } from "../stores/nestStore";
import { selectEdgesForNest, usePrGraphStore } from "../stores/prGraphStore";
import { deriveNestLifecycle } from "../utils/nestLifecycle";
import { CommandConsole } from "./CommandConsole";
import { CompactNestDialog } from "./CompactNestDialog";
import { STATUS_BADGE_COLOR, type TaskStatus } from "./hogletStatus";
import { MarkValidatedDialog } from "./MarkValidatedDialog";
import {
  type FeedbackRoutedPayload,
  type PrGraphRoutedPayload,
  parseFeedbackRoutedPayload,
  parsePrGraphRoutedPayload,
} from "./nest-payload-schemas";

const log = logger.scope("nest-detail-panel");

interface NestDetailPanelProps {
  nest: Nest;
  onClose: () => void;
  onRelocate?: () => void;
  /**
   * Called when the user clicks a hoglet card inside the panel. Lets the
   * parent map view swap selection from this nest to the hoglet (which opens
   * the HogletDetailPanel and pans the camera to it).
   */
  onFocusHoglet?: (hogletId: string) => void;
}

export function NestDetailPanel({
  nest,
  onClose,
  onRelocate,
  onFocusHoglet,
}: NestDetailPanelProps) {
  const t = useFunSpeak();
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
  const hedgehogState = useNestStore(selectHedgehogState(nest.id));

  const hoglets = useHogletStore(selectNestHoglets(nest.id));
  const taskSummaries = useHogletStore((s) => s.taskSummaries);
  const lifecycle = useMemo(
    () =>
      deriveNestLifecycle({
        nest,
        hoglets,
        taskStatusFor: (taskId) =>
          (selectTaskSummary(taskId)({ taskSummaries } as never)?.latest_run
            ?.status as TaskStatus | null) ?? "not_started",
      }),
    [nest, hoglets, taskSummaries],
  );

  const editable = lifecycle === "planning" || lifecycle === "working";
  const showChatComposer = lifecycle !== "dormant" && lifecycle !== "archived";

  const validatedTaskIds = useMemo(
    () => hoglets.map((h) => h.taskId),
    [hoglets],
  );

  const validationDefaultSummary = useMemo(() => {
    const lines = [
      nest.definitionOfDone
        ? `Definition of done met: ${nest.definitionOfDone}`
        : "Goal satisfied.",
    ];
    if (hoglets.length > 0) {
      lines.push(`${hoglets.length} hoglet(s) completed their work.`);
    }
    return lines.join("\n\n");
  }, [nest.definitionOfDone, hoglets.length]);

  const [validateDialogOpen, setValidateDialogOpen] = useState(false);
  const [compactDialogOpen, setCompactDialogOpen] = useState(false);

  const [chatDraft, setChatDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setName(nest.name);
    setGoalPrompt(nest.goalPrompt);
    setDefinitionOfDone(nest.definitionOfDone ?? "");
    setError(null);
    setChatDraft("");
    setChatError(null);
    void loadNestChatMessages(nest.id);
  }, [nest]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on nest open and once messages finish loading
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end" });
    });
    return () => cancelAnimationFrame(raf);
  }, [nest.id, loadingMessages, messages.length]);

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
      await trpcClient.hedgemony.nests.archive.mutate({
        id: nest.id,
      });
      useNestStore.getState().startDying(nest.id, nest.mapX, nest.mapY);
      onClose();
    } catch (e) {
      log.error("Failed to archive nest", { id: nest.id, error: e });
      setError(e instanceof Error ? e.message : "Failed to archive nest");
      setArchiving(false);
    }
  };

  useHotkeys("s", () => void handleSave(), [
    canSave,
    saving,
    archiving,
    name,
    goalPrompt,
    definitionOfDone,
  ]);
  useHotkeys("a", () => void handleArchive(), [saving, archiving]);
  useHotkeys("r", () => {
    if (onRelocate && !saving && !archiving) onRelocate();
  }, [onRelocate, saving, archiving]);

  return (
    <CommandConsole
      consoleKey={nest.id}
      placement="right"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenuCapture={(e) => e.stopPropagation()}
    >
      <CommandConsole.Header
        eyebrow={
          <span className="flex items-center gap-2">
            {t("Nest")}
            {hedgehogState?.state === "ticking" && (
              <span className="flex items-center gap-1 rounded-full bg-(--amber-a3) px-2 py-0.5 text-(--amber-11) text-[10px] normal-case tracking-normal">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-(--amber-9)" />
                {t("Hedgehog ticking…")}
              </span>
            )}
          </span>
        }
        title={nest.name}
        onClose={onClose}
        trailing={
          onRelocate && (
            <Tooltip content={`${t("Relocate nest")} (R)`} side="top">
              <IconButton
                size="1"
                variant="soft"
                color="gray"
                onClick={onRelocate}
                disabled={saving || archiving}
                aria-label="Relocate nest"
              >
                <ArrowsOutCardinal size={14} />
              </IconButton>
            </Tooltip>
          )
        }
      />

      <ScrollArea
        type="auto"
        scrollbars="vertical"
        className="scroll-area-constrain-width min-h-0 flex-1"
      >
        <Flex direction="column" gap="4" px="4" py="3" className="min-w-0">
          {lifecycle === "validating" && (
            <div className="rounded-(--radius-2) border border-(--purple-7) bg-(--purple-2) p-3">
              <Flex direction="column" gap="2">
                <Flex align="center" gap="2">
                  <Sparkle
                    size={16}
                    weight="fill"
                    className="text-(--purple-11)"
                  />
                  <Text size="2" weight="medium" className="text-(--purple-12)">
                    Ready to validate
                  </Text>
                </Flex>
                <Text size="2" color="gray">
                  All hoglets finished and the definition of done is set. Review
                  and confirm the goal is met.
                </Text>
                <Button
                  size="2"
                  color="purple"
                  onClick={() => setValidateDialogOpen(true)}
                  className="self-start"
                >
                  <CheckCircle size={14} />
                  Mark validated
                </Button>
              </Flex>
            </div>
          )}

          {lifecycle === "validated" && (
            <div className="rounded-(--radius-2) border border-(--green-7) bg-(--green-2) p-3">
              <Flex direction="column" gap="2">
                <Flex align="center" gap="2">
                  <CheckCircle
                    size={16}
                    weight="fill"
                    className="text-(--green-11)"
                  />
                  <Text size="2" weight="medium" className="text-(--green-12)">
                    Validated
                  </Text>
                </Flex>
                <Text size="2" color="gray">
                  Goal confirmed. Compact the nest when you no longer need the
                  full chat trail.
                </Text>
              </Flex>
            </div>
          )}

          <LabeledField label="Name" htmlFor="nest-detail-name">
            <TextField.Root
              id="nest-detail-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving || archiving || !editable}
            />
          </LabeledField>

          <LabeledField label="Goal" htmlFor="nest-detail-goal">
            <TextArea
              id="nest-detail-goal"
              value={goalPrompt}
              onChange={(e) => setGoalPrompt(e.target.value)}
              rows={3}
              disabled={saving || archiving || !editable}
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
              rows={2}
              disabled={saving || archiving || !editable}
            />
          </LabeledField>

          {error && (
            <Text size="2" color="red">
              {error}
            </Text>
          )}

          <HogletsSection
            nestId={nest.id}
            onFocusHoglet={onFocusHoglet}
            disabled={saving || archiving}
          />

          <PrGraphSection nestId={nest.id} />

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
          <div ref={bottomRef} />
        </Flex>
      </ScrollArea>

      {showChatComposer && (
        <div className="flex flex-col gap-2 border-(--accent-a5) border-t bg-(--gray-a2) px-3 py-2">
          <Flex gap="2" align="center">
            <TextField.Root
              placeholder={t("Message the hedgehog…")}
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              onKeyDown={handleChatKeyDown}
              disabled={sending}
              className="flex-1"
            />
            <IconButton
              onClick={handleSendChat}
              disabled={!chatDraft.trim() || sending}
              loading={sending}
              size="2"
              variant="soft"
              aria-label="Send message"
            >
              <PaperPlaneRight size={14} />
            </IconButton>
          </Flex>
          {chatError && (
            <Text size="1" color="red">
              {chatError}
            </Text>
          )}
        </div>
      )}

      <CommandConsole.Footer align="end">
        {editable && (
          <Button
            onClick={handleSave}
            disabled={!canSave || saving || archiving}
            loading={saving}
            size="2"
            title="Save (S)"
          >
            <FloppyDisk size={14} />
            {t("Save")}
            <KeyHint className="ml-1">S</KeyHint>
          </Button>
        )}
        {lifecycle === "validated" && (
          <Button
            color="gray"
            variant="soft"
            onClick={() => setCompactDialogOpen(true)}
            disabled={saving || archiving}
            size="2"
          >
            <Archive size={14} />
            Compact nest
          </Button>
        )}
        {lifecycle !== "dormant" && lifecycle !== "archived" && (
          <Button
            variant="soft"
            color="red"
            onClick={handleArchive}
            disabled={saving || archiving}
            loading={archiving}
            size="2"
            title="Archive (A)"
          >
            <Archive size={14} />
            {t("Archive")}
            <KeyHint className="ml-1">A</KeyHint>
          </Button>
        )}
      </CommandConsole.Footer>

      <MarkValidatedDialog
        open={validateDialogOpen}
        onOpenChange={setValidateDialogOpen}
        nest={nest}
        defaultSummary={validationDefaultSummary}
        defaultPrUrls={[]}
        defaultTaskIds={validatedTaskIds}
        onValidated={(validated) => useNestStore.getState().upsert(validated)}
      />
      <CompactNestDialog
        open={compactDialogOpen}
        onOpenChange={setCompactDialogOpen}
        nest={nest}
        onCompacted={(compacted) => useNestStore.getState().upsert(compacted)}
      />
    </CommandConsole>
  );
}

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

function NestChatMessage({ message }: { message: NestMessage }) {
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

const HOGLET_STATUS_LABEL: Record<NonNullable<TaskStatus>, string> = {
  not_started: "Not started",
  queued: "Queued",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function HogletsSection({
  nestId,
  onFocusHoglet,
  disabled,
}: {
  nestId: string;
  onFocusHoglet?: (hogletId: string) => void;
  disabled: boolean;
}) {
  const t = useFunSpeak();
  const hoglets = useHogletStore(selectNestHoglets(nestId));
  const ordered = useMemo<Hoglet[]>(
    () =>
      [...hoglets].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [hoglets],
  );

  return (
    <div className="flex flex-col gap-2 border-(--gray-5) border-t pt-3">
      <Flex align="center" justify="between" gap="2">
        <Text size="2" weight="medium">
          {t("Hoglets")}
        </Text>
        <Text size="1" color="gray">
          {ordered.length === 0
            ? t("None")
            : ordered.length === 1
              ? "1"
              : ordered.length}
        </Text>
      </Flex>
      {ordered.length === 0 ? (
        <Text size="1" color="gray">
          {t(
            "No hoglets yet. The hedgehog will spawn them, or drag a wild hoglet onto this nest.",
          )}
        </Text>
      ) : (
        <Flex direction="column" gap="1">
          {ordered.map((hoglet) => (
            <HogletCard
              key={hoglet.id}
              hoglet={hoglet}
              nestId={nestId}
              onFocus={onFocusHoglet}
              disabled={disabled}
            />
          ))}
        </Flex>
      )}
    </div>
  );
}

function HogletCard({
  hoglet,
  nestId,
  onFocus,
  disabled,
}: {
  hoglet: Hoglet;
  nestId: string;
  onFocus?: (hogletId: string) => void;
  disabled: boolean;
}) {
  const summary = useHogletStore(selectTaskSummary(hoglet.taskId));
  const status: NonNullable<TaskStatus> = (summary?.latest_run?.status ??
    "not_started") as NonNullable<TaskStatus>;
  const title = summary?.title ?? hoglet.taskId.slice(0, 12);
  const [releasing, setReleasing] = useState(false);
  const [retireDialogOpen, setRetireDialogOpen] = useState(false);
  const [retiring, setRetiring] = useState(false);

  const handleFocus = () => {
    if (onFocus) onFocus(hoglet.id);
  };

  const handleRelease = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (releasing) return;
    setReleasing(true);
    try {
      await releaseHoglet(hoglet.id, nestId);
    } finally {
      setReleasing(false);
    }
  };

  const handleRetire = async () => {
    if (retiring) return;
    setRetiring(true);
    try {
      await trpcClient.hedgemony.hoglets.retire.mutate({
        hogletId: hoglet.id,
      });
      useHogletStore.getState().remove(nestId, hoglet.id);
    } catch (error) {
      log.error("Failed to retire hoglet", {
        hogletId: hoglet.id,
        error,
      });
    } finally {
      setRetireDialogOpen(false);
      setRetiring(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-(--radius-2) border border-(--gray-4) bg-(--gray-a2) px-2 py-1.5 transition-colors hover:border-(--accent-7)">
      <button
        type="button"
        onClick={handleFocus}
        disabled={!onFocus}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left disabled:cursor-default"
        title={onFocus ? "Focus hoglet" : undefined}
      >
        <Text
          size="2"
          weight="medium"
          className="line-clamp-1 w-full text-(--gray-12)"
        >
          {title}
        </Text>
        <Flex align="center" gap="2">
          <Badge color={STATUS_BADGE_COLOR[status]} size="1" variant="soft">
            {HOGLET_STATUS_LABEL[status]}
          </Badge>
          {hoglet.signalReportId && (
            <Text size="1" color="gray">
              signal
            </Text>
          )}
        </Flex>
      </button>
      <Flex align="center" gap="1" className="shrink-0">
        {onFocus && (
          <Tooltip content="Focus on map" side="top">
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              onClick={handleFocus}
              disabled={disabled}
              aria-label="Focus hoglet"
            >
              <Crosshair size={12} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip content="Release to wild" side="top">
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={handleRelease}
            disabled={disabled || releasing}
            loading={releasing}
            aria-label="Release hoglet to wild"
          >
            <SignOut size={12} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Retire hoglet" side="top">
          <IconButton
            size="1"
            variant="ghost"
            color="red"
            onClick={() => setRetireDialogOpen(true)}
            disabled={disabled || retiring}
            aria-label="Retire hoglet"
          >
            <Trash size={12} />
          </IconButton>
        </Tooltip>
      </Flex>
      <AlertDialog.Root
        open={retireDialogOpen}
        onOpenChange={setRetireDialogOpen}
      >
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>
            <Flex align="center" gap="2">
              <Warning size={18} weight="fill" color="var(--red-9)" />
              <Text className="font-bold">Retire this hoglet?</Text>
            </Flex>
          </AlertDialog.Title>
          <AlertDialog.Description className="text-sm">
            <Text>
              The hoglet will be removed from the map. The underlying task is
              not deleted and can still be opened from your task list.
            </Text>
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="solid"
                color="red"
                onClick={handleRetire}
                disabled={retiring}
                loading={retiring}
              >
                Retire
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  );
}

function PrGraphSection({ nestId }: { nestId: string }) {
  const t = useFunSpeak();
  const edges = usePrGraphStore(selectEdgesForNest(nestId));
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  const handleUnlink = async (edgeId: string) => {
    setUnlinkingId(edgeId);
    try {
      await trpcClient.hedgemony.prGraph.unlink.mutate({ id: edgeId });
    } catch (e) {
      log.error("Failed to unlink pr dependency", { edgeId, error: e });
    } finally {
      setUnlinkingId(null);
    }
  };

  if (edges.length === 0) return null;

  return (
    <div className="border-(--gray-5) border-t pt-4">
      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          {t("PR graph")}
        </Text>
        {edges.map((edge) => (
          <PrGraphEdgeRow
            key={edge.id}
            edge={edge}
            onUnlink={handleUnlink}
            disabled={unlinkingId === edge.id}
          />
        ))}
      </Flex>
    </div>
  );
}

function PrGraphEdgeRow({
  edge,
  onUnlink,
  disabled,
}: {
  edge: PrDependencyView;
  onUnlink: (edgeId: string) => void | Promise<void>;
  disabled: boolean;
}) {
  return (
    <Flex
      align="center"
      gap="2"
      className="rounded-(--radius-2) border border-(--gray-4) bg-(--gray-2) p-2"
    >
      <ArrowsClockwise size={12} className="text-(--gray-10)" />
      <Flex direction="column" gap="1" className="min-w-0 flex-1">
        <Text size="1" className="truncate font-mono text-(--gray-11)">
          {edge.parentTaskId.slice(0, 8)} → {edge.childTaskId.slice(0, 8)}
        </Text>
        <Text size="1" color="gray">
          updated {new Date(edge.updatedAt).toLocaleString()}
        </Text>
      </Flex>
      <PrGraphStateBadge state={edge.state} />
      <IconButton
        type="button"
        variant="ghost"
        color="gray"
        size="1"
        title="Unlink"
        disabled={disabled}
        onClick={() => onUnlink(edge.id)}
      >
        <X size={12} />
      </IconButton>
    </Flex>
  );
}

function PrGraphStateBadge({ state }: { state: PrDependencyView["state"] }) {
  const color: "amber" | "green" | "red" | "purple" = (() => {
    switch (state) {
      case "pending":
        return "amber";
      case "satisfied":
        return "green";
      case "broken":
        return "red";
      case "follow_up":
        return "purple";
    }
  })();
  return (
    <Badge color={color} size="1" variant="soft">
      {state}
    </Badge>
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

function LabeledField({
  label,
  htmlFor,
  children,
  minWidth,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="flex flex-1 flex-col" style={{ minWidth }}>
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
