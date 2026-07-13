import {
  ArchiveIcon,
  ArrowSquareOutIcon,
  ChatCircleIcon,
  DotsThreeIcon,
  GitBranchIcon,
  RobotIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  Badge,
  Button,
  Card,
  CardContent,
  ChatMarker,
  ChatMarkerContent,
  ChatMessageScroller,
  ChatMessageScrollerButton,
  ChatMessageScrollerContent,
  ChatMessageScrollerItem,
  ChatMessageScrollerProvider,
  ChatMessageScrollerViewport,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
  ThreadItem,
  ThreadItemAction,
  ThreadItemActions,
  ThreadItemAuthor,
  ThreadItemBody,
  ThreadItemContent,
  ThreadItemGutter,
  ThreadItemHeader,
  ThreadItemReplies,
  ThreadItemRepliesLabel,
  ThreadItemRepliesMeta,
  ThreadItemTimestamp,
} from "@posthog/quill";
import { formatRelativeTimeShort } from "@posthog/shared";
import type { Task, TaskRunStatus } from "@posthog/shared/domain-types";
import { isTerminalStatus } from "@posthog/shared/domain-types";
import { getUserInitials } from "@posthog/ui/features/auth/userInitials";
import { TaskTabIcon } from "@posthog/ui/features/browser-tabs/TaskTabIcon";
import {
  MentionText,
  mentionChipClass,
  TaskLinkIcon,
} from "@posthog/ui/features/canvas/components/MentionText";
import type {
  ChannelFeedSystemMessage,
  DemoButtonPreset,
} from "@posthog/ui/features/canvas/hooks/useChannelFeedMessages";
import { useChannelTaskData } from "@posthog/ui/features/canvas/hooks/useChannelTaskData";
import { useTaskThread } from "@posthog/ui/features/canvas/hooks/useTaskThread";
import { useThreadPanelStore } from "@posthog/ui/features/canvas/stores/threadPanelStore";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import {
  type SidebarPrState,
  useTaskPrStatus,
} from "@posthog/ui/features/sidebar/useTaskPrStatus";
import {
  getCachedTask,
  taskDetailQuery,
} from "@posthog/ui/features/tasks/queries";
import { useInView } from "@posthog/ui/primitives/hooks/useInView";
import { toast } from "@posthog/ui/primitives/toast";
import { Text } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, memo, type ReactNode, useMemo } from "react";

// Feed rows poll their reply counts slower than the open thread panel — the
// shared query key means an open panel naturally speeds the row up too.
const FEED_REPLIES_POLL_INTERVAL_MS = 15_000;

const STATUS_LABELS: Record<TaskRunStatus, string> = {
  not_started: "Not started",
  queued: "Queued",
  in_progress: "In progress",
  // "Ready", not "Completed": the agent has finished its work and the task is
  // ready to look at, but the change itself isn't necessarily shipped/done.
  completed: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

// Once a PR exists its GitHub state is the truest top-line status — more
// accurate than the run status, which routinely lingers on "in_progress"
// (or a stale cloud status) after the agent opens the PR. Mirrors the PR
// states the sidebar's TaskIcon already renders.
const PR_STATE_LABELS: Record<
  Exclude<SidebarPrState, null>,
  { label: string; variant: "success" | "info" | "default" | "destructive" }
> = {
  merged: { label: "Merged", variant: "default" },
  open: { label: "PR ready", variant: "info" },
  draft: { label: "Draft PR", variant: "default" },
  closed: { label: "Closed", variant: "destructive" },
};

function statusBadge(status: TaskRunStatus) {
  const variant =
    status === "completed"
      ? "success"
      : status === "failed"
        ? "destructive"
        : status === "in_progress"
          ? "info"
          : "default";
  return (
    <Badge variant={variant}>
      {status === "in_progress" && <Spinner className="size-2.5" />}
      {STATUS_LABELS[status]}
    </Badge>
  );
}

// Local calendar-day identity, so tasks created on the same day share a heading
// regardless of time. Uses local getters (not the UTC ISO) so the split lands
// on the viewer's midnight.
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const rem = n % 100;
  return `${n}${suffix[(rem - 20) % 10] ?? suffix[rem] ?? suffix[0]}`;
}

// The day-separator label: "Today" / "Yesterday" for the recent days, then a
// weekday + ordinal ("Monday 5th") within the week, adding the month (and the
// year when it differs) further back so older separators stay unambiguous.
function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
  const day = ordinal(date.getDate());
  if (days < 7) return `${weekday} ${day}`;
  const month = date.toLocaleDateString(undefined, { month: "long" });
  const year =
    date.getFullYear() === now.getFullYear() ? "" : `, ${date.getFullYear()}`;
  return `${weekday}, ${month} ${day}${year}`;
}

interface TaskStatusDisplay {
  // The run/environment badge ("Local", "Completed", "In progress", …).
  base: ReactNode;
  // The PR's GitHub state, shown alongside the run badge when a PR exists.
  prState: Exclude<SidebarPrState, null> | null;
  // Whether the PR has merged — the card lifts this to a purple border + tint.
  isMerged: boolean;
}

// Live status for the card, derived the same way the sidebar's TaskIcon does
// (via useChannelTaskData: local session + workspace + cloud run). The raw
// `latest_run.status` alone is wrong for local runs — the backend row often
// stays "queued" while the agent runs on the creator's machine — so it is
// only trusted for cloud runs and terminal states (which imply a sync).
//
// Once a PR exists its state ("PR ready", "Merged", …) is the sole top-line
// status — it replaces the run badge rather than sitting next to it, so a
// shipped task never reads "Ready + Merged" or a stale "In progress + PR
// ready". A failed/cancelled run suppresses the PR badge instead — that is a
// deliberate end state we should not soften with a PR.
function useTaskStatusDisplay(task: Task): TaskStatusDisplay {
  const data = useChannelTaskData(task);
  const { prState } = useTaskPrStatus({
    id: task.id,
    cloudPrUrl: data?.cloudPrUrl ?? null,
    taskRunEnvironment: data?.taskRunEnvironment ?? null,
  });
  const status = data?.taskRunStatus ?? task.latest_run?.status;
  const environment = data?.taskRunEnvironment ?? task.latest_run?.environment;
  // `prState` is resolved async from git/`gh` and is routinely null for cloud
  // tasks (the details fetch hasn't landed, or there's no cached row). But the
  // PR URL itself is a hard signal a PR exists — the card's "PR" link keys off
  // exactly this. Fall back to it so the badge and the link never disagree; a
  // known URL with no resolved state is shown as the neutral "open" ("PR
  // ready"), never something stronger like "merged".
  const hasPrUrl =
    typeof (data?.cloudPrUrl ?? task.latest_run?.output?.pr_url) === "string";
  const effectivePrState: Exclude<SidebarPrState, null> | null =
    prState ?? (hasPrUrl ? "open" : null);
  const showPrState =
    !!effectivePrState && status !== "failed" && status !== "cancelled";

  let base: ReactNode;
  if (data?.needsPermission) {
    // Live, actionable states still win over the PR badge — the agent is
    // waiting on the user right now, which matters more than a PR existing.
    base = <Badge variant="warning">Needs input</Badge>;
  } else if (data?.isGenerating) {
    base = (
      <Badge variant="info">
        <Spinner className="size-2.5" />
        In progress
      </Badge>
    );
  } else if (showPrState) {
    // Otherwise the PR badge is the whole story once a PR exists; skip the run
    // badge so we never show "Ready + Merged" or a stale "In progress".
    base = null;
  } else if (!status) {
    base = <Badge>Draft</Badge>;
  } else if (environment === "cloud" || isTerminalStatus(status)) {
    base = statusBadge(status);
  } else {
    // Local, non-terminal: the run status is unreliable (the backend row stays
    // "queued" while the agent runs on the creator's machine), so we render no
    // status badge rather than a misleading one.
    base = null;
  }

  return {
    base,
    prState: showPrState ? effectivePrState : null,
    isMerged: showPrState && effectivePrState === "merged",
  };
}

// The merged badge borrows the purple GitHub-merge accent (matching the
// sidebar's TaskIcon merge glyph). Quill has no purple variant, so we tint a
// neutral badge with the Radix purple scale — allowed inline because the
// values are CSS variables, not hardcoded colors.
function PrStateBadge({ prState }: { prState: Exclude<SidebarPrState, null> }) {
  const { label, variant } = PR_STATE_LABELS[prState];
  if (prState === "merged") {
    return (
      <Badge
        variant="default"
        style={{
          backgroundColor: "var(--purple-a3)",
          color: "var(--purple-11)",
        }}
      >
        {label}
      </Badge>
    );
  }
  return <Badge variant={variant}>{label}</Badge>;
}

function TaskStatusBadge({ display }: { display: TaskStatusDisplay }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {display.base}
      {display.prState && <PrStateBadge prState={display.prState} />}
    </div>
  );
}

// The task the message kicked off, as a card everyone in the channel sees:
// bold title + status up top, then run metadata.
export function TaskCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const statusDisplay = useTaskStatusDisplay(task);
  const prUrl =
    typeof task.latest_run?.output?.pr_url === "string"
      ? task.latest_run.output.pr_url
      : undefined;
  const stage = task.latest_run?.stage;

  return (
    <Card
      size="sm"
      className={cn(
        "mt-1.5 w-full cursor-pointer rounded-sm py-0 transition-none hover:bg-fill-hover",
        statusDisplay.isMerged
          ? "border-transparent bg-(--purple-a2) shadow-[0_0_0_1px_var(--purple-8)] hover:bg-(--purple-a3) dark:bg-(--purple-a1) dark:hover:bg-(--purple-a2)"
          : "hover:border-border-primary",
      )}
      onClick={onOpen}
    >
      <CardContent className="flex flex-col gap-1 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {/* Same live status icon as the code side nav, so the card and the
                nav never disagree (generating spinner, needs-permission, cloud
                status colors, PR state). */}
            <TaskTabIcon task={task} size={14} />
            <span className="line-clamp-2 font-medium">
              {task.title || "Untitled task"}
            </span>
          </div>
          <TaskStatusBadge display={statusDisplay} />
        </div>
        {(stage || task.repository || prUrl) && (
          <div className="flex min-w-0 items-center gap-3">
            {task.repository && (
              <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                <GitBranchIcon size={12} />
                {task.repository}
              </span>
            )}
            {stage && (
              <Text size="1" className="truncate text-muted-foreground">
                {stage}
              </Text>
            )}
            {prUrl && (
              <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
                <ArrowSquareOutIcon size={12} />
                PR
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// The reply row under the card, always present at a constant height: the
// Slack-style teaser (author facepile, count, last-reply time) once the thread
// has messages, and a quiet "Reply" affordance otherwise. Keeping the row
// mounted at a fixed height means the teaser swaps in after the thread fetch
// lands without shifting the feed — and it surfaces an always-visible way into
// the thread instead of hiding it in the hover toolbar.
//
// The fetch/poll only runs for near-viewport rows (`inView`); off-screen rows
// render the static affordance and idle, so a long feed isn't polling per row.
function ReplyFooter({
  taskId,
  inView,
  onOpenThread,
}: {
  taskId: string;
  inView: boolean;
  onOpenThread: () => void;
}) {
  const { messages } = useTaskThread(taskId, {
    pollIntervalMs: FEED_REPLIES_POLL_INTERVAL_MS,
    enabled: inView,
  });
  const authors = useMemo(() => {
    const seen = new Map<string, (typeof messages)[number]["author"]>();
    for (const message of messages) {
      const key = message.author?.uuid ?? "unknown";
      if (!seen.has(key)) seen.set(key, message.author);
    }
    return [...seen.values()].slice(0, 4);
  }, [messages]);

  if (messages.length === 0) {
    // A single avatar-sized slot keeps this row the exact height of the
    // populated teaser, so swapping to it after the fetch never shifts the feed.
    return (
      <ThreadItemReplies onClick={onOpenThread} className="mt-1">
        <AvatarGroup size="xs">
          <Avatar size="xs">
            <AvatarFallback>
              <ChatCircleIcon size={12} />
            </AvatarFallback>
          </Avatar>
        </AvatarGroup>
        <ThreadItemRepliesLabel className="text-(--muted-foreground)">
          Reply
        </ThreadItemRepliesLabel>
      </ThreadItemReplies>
    );
  }

  const last = messages[messages.length - 1];
  return (
    <ThreadItemReplies onClick={onOpenThread} className="mt-1">
      <AvatarGroup size="xs">
        {authors.map((author, index) => (
          <Avatar key={author?.uuid ?? index} size="xs">
            <AvatarFallback>{getUserInitials(author)}</AvatarFallback>
          </Avatar>
        ))}
      </AvatarGroup>
      <ThreadItemRepliesLabel>
        {messages.length} {messages.length === 1 ? "reply" : "replies"}
      </ThreadItemRepliesLabel>
      <ThreadItemRepliesMeta>
        Last reply {formatRelativeTimeShort(last.created_at)}
      </ThreadItemRepliesMeta>
    </ThreadItemReplies>
  );
}

const FeedItem = memo(function FeedItem({
  task,
  inView,
  onOpenTask,
  onOpenThread,
}: {
  task: Task;
  inView: boolean;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  return (
    <ThreadItem className="rounded-none py-4 pr-8 hover:bg-fill-hover/50">
      <ThreadItemGutter>
        <Avatar>
          <AvatarFallback>
            <RobotIcon size={16} />
          </AvatarFallback>
        </Avatar>
      </ThreadItemGutter>

      <ThreadItemContent className="min-w-0">
        <ThreadItemHeader>
          <ThreadItemAuthor>PostHog</ThreadItemAuthor>
          {/* <Badge variant="info">Agent</Badge> */}
          <ThreadItemTimestamp
            dateTime={new Date(task.created_at).toISOString()}
          >
            {formatRelativeTimeShort(task.created_at)}
          </ThreadItemTimestamp>
        </ThreadItemHeader>

        <ThreadItemBody className="wrap-break-word">
          {/* Only attribute channel-started tasks: other origins (Slack,
              automations) carry a created_by who didn't start it here. */}
          {task.origin_product === "user_created" && task.created_by ? (
            <>
              {/* Mention-styled but rendered inert: the starter shouldn't be
                  notified about their own task. */}
              <span className={mentionChipClass}>
                @{userDisplayName(task.created_by)}
              </span>{" "}
              started a new task
            </>
          ) : (
            "A new task was started"
          )}
        </ThreadItemBody>

        <TaskCard task={task} onOpen={() => onOpenTask(task)} />
        <ReplyFooter
          taskId={task.id}
          inView={inView}
          onOpenThread={() => onOpenThread(task)}
        />
      </ThreadItemContent>

      {/* Replying now lives in the always-visible ReplyFooter, so the hover
          toolbar only carries the distinct "Open task" action. Actions anchor
          to the row's top-right corner; a top tooltip there overhangs the panel
          edge and gets clipped by the scroll container, so open tooltips toward
          the content instead. */}
      <ThreadItemActions aria-label="Message actions" className="inset-bs-2">
        <ThreadItemAction label="Open task" onClick={() => onOpenTask(task)}>
          <ArrowSquareOutIcon size={15} />
        </ThreadItemAction>
      </ThreadItemActions>
    </ThreadItem>
  );
});

// One feed row: owns the scroller item (the `content-visibility` boundary, so
// its box is always laid out and safe to observe) and reports whether it is
// near the viewport, letting `FeedItem` shed off-screen polling.
function FeedRow({
  task,
  onOpenTask,
  onOpenThread,
}: {
  task: Task;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
}) {
  const [ref, inView] = useInView<HTMLDivElement>({ rootMargin: "1200px 0px" });
  return (
    <ChatMessageScrollerItem
      ref={ref}
      messageId={task.id}
      // Rows already get `content-visibility:auto` from quill, but its default
      // `contain-intrinsic-size` (10rem) under-reserves a feed row (message +
      // task card + replies ≈ 13rem), so off-screen rows collapse too small and
      // the scrollbar jumps as they paint in. A closer estimate keeps scrolling
      // stable; `auto` still remembers each row's real height after first paint.
      className="[contain-intrinsic-size:auto_13rem]"
    >
      <FeedItem
        task={task}
        inView={inView}
        onOpenTask={onOpenTask}
        onOpenThread={onOpenThread}
      />
    </ChatMessageScrollerItem>
  );
}

// A card-less feed row for a synthetic "PostHog agent" announcement (context
// created, CONTEXT.md being built). Same chrome as a task row — Robot avatar,
// "PostHog / Agent" — minus the task card and reply footer.
function SystemFeedRow({ message }: { message: ChannelFeedSystemMessage }) {
  return (
    <ChatMessageScrollerItem messageId={message.id}>
      <ThreadItem className="rounded-none py-4 pr-8">
        <ThreadItemGutter>
          <Avatar>
            <AvatarFallback>
              <RobotIcon size={16} />
            </AvatarFallback>
          </Avatar>
        </ThreadItemGutter>
        <ThreadItemContent className="min-w-0">
          <ThreadItemHeader>
            <ThreadItemAuthor>PostHog</ThreadItemAuthor>
            <Badge variant="info">Agent</Badge>
            <ThreadItemTimestamp dateTime={message.createdAt}>
              {formatRelativeTimeShort(message.createdAt)}
            </ThreadItemTimestamp>
          </ThreadItemHeader>
          <ThreadItemBody className="wrap-break-word text-muted-foreground">
            {message.text}
          </ThreadItemBody>
        </ThreadItemContent>
      </ThreadItem>
    </ChatMessageScrollerItem>
  );
}

// Buttons derived from a task's live PR / merge state: "Merged" once it lands,
// otherwise a "Review PR" action. A "View PR" button appears when the task has a
// real PR URL. Used by the demo message's `task-pr` button preset, keyed off its
// replied task; the buttons always render (they're a demo affordance) but the
// state reflects the real task when it has one.
function TaskPrButtons({ taskId }: { taskId: string }) {
  const { data } = useQuery({ ...taskDetailQuery(taskId), staleTime: 30_000 });
  const task = data ?? getCachedTask(taskId);
  const prUrl =
    typeof task?.latest_run?.output?.pr_url === "string"
      ? task.latest_run.output.pr_url
      : undefined;
  const { prState } = useTaskPrStatus({
    id: taskId,
    cloudPrUrl: prUrl ?? null,
    taskRunEnvironment: task?.latest_run?.environment ?? null,
  });
  const merged = prState === "merged";
  const openPr = () =>
    prUrl
      ? window.open(prUrl, "_blank", "noopener,noreferrer")
      : toast.success("Review started");
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      {merged ? (
        <Badge variant="default">Merged</Badge>
      ) : (
        <Button variant="outline" size="sm" onClick={openPr}>
          Review PR
        </Button>
      )}
      {prUrl && (
        <Button variant="default" size="sm" onClick={openPr}>
          <ArrowSquareOutIcon size={14} />
          View PR
        </Button>
      )}
    </div>
  );
}

// Initials for a free-text persona name (the demo composer lets you type any
// "from"), so a fake human message gets a sensible avatar fallback.
function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// A dev-only "fake" message rendered as a full thread item: the chosen persona's
// avatar + name, then the body rendered the same way real thread messages are
// (MentionText — @mention chips + linkified URLs). Presentational, so the header
// composer can reuse it as a live preview. `createdAt` omitted (preview) hides
// the timestamp.
export function DemoMessageItem({
  fromName,
  fromKind,
  content,
  createdAt,
  replyTo,
  buttons,
  onDelete,
}: {
  fromName: string;
  fromKind: "human" | "agent";
  content: string;
  createdAt?: string;
  /** When set, renders a Slack-style "replied to a thread: …" preview line. */
  replyTo?: { label: string; href: string };
  /** When set, renders a preset row of action buttons. */
  buttons?: DemoButtonPreset;
  onDelete?: () => void;
}) {
  const navigate = useNavigate();
  const openThread = useThreadPanelStore((s) => s.openThread);
  // The reply target is a task deep link; clicking opens that task's *thread*
  // dock (not the full task page) in its channel home.
  const replyMatch = replyTo?.href.match(
    /\/website\/([^/]+)\/tasks\/([^/?#]+)/,
  );
  const openReplyThread = () => {
    if (!replyMatch) return;
    const [, replyChannelId, taskId] = replyMatch;
    openThread(replyChannelId, taskId);
    void navigate({
      to: "/website/$channelId",
      params: { channelId: replyChannelId },
    });
  };
  return (
    <ThreadItem className="rounded-none py-4 pr-8">
      <ThreadItemGutter>
        <Avatar>
          <AvatarFallback>
            {fromKind === "agent" ? (
              <RobotIcon size={16} />
            ) : (
              initialsFromName(fromName)
            )}
          </AvatarFallback>
        </Avatar>
      </ThreadItemGutter>
      <ThreadItemContent className="min-w-0">
        <ThreadItemHeader>
          <ThreadItemAuthor>{fromName || "Someone"}</ThreadItemAuthor>
          {/* {fromKind === "agent" && <Badge variant="info">Agent</Badge>} */}
          {createdAt && (
            <ThreadItemTimestamp dateTime={createdAt}>
              {formatRelativeTimeShort(createdAt)}
            </ThreadItemTimestamp>
          )}
        </ThreadItemHeader>
        {replyTo && (
          <div className="flex items-center gap-1 text-muted-foreground text-xs">
            <span>replied to a thread:</span>
            {/* Opens the task's thread dock (not the task page); the live
                task-status icon matches reference links. */}
            <button
              type="button"
              onClick={openReplyThread}
              className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
            >
              {replyMatch && <TaskLinkIcon taskId={replyMatch[2]} />}
              <span className="truncate">{replyTo.label}</span>
            </button>
          </div>
        )}
        <ThreadItemBody className="wrap-break-word">
          {content ? (
            // Same renderer as real thread messages: @mentions become chips and
            // bare URLs linkify, so a fake message reads exactly like a real one.
            <MentionText
              content={content}
              markdownLinks
              className="block whitespace-pre-wrap"
            />
          ) : (
            <span className="text-muted-foreground text-sm">
              Your message will appear here…
            </span>
          )}
        </ThreadItemBody>
        {buttons === "inbox-item" && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.success("Review started")}
            >
              Review
            </Button>
            <Button
              variant="default"
              size="sm"
              aria-label="Archive"
              onClick={() => toast.success("Archived")}
            >
              <ArchiveIcon size={14} />
            </Button>
          </div>
        )}
        {buttons === "task-pr" && replyMatch && (
          <TaskPrButtons taskId={replyMatch[2]} />
        )}
      </ThreadItemContent>
      {onDelete && (
        <ThreadItemActions aria-label="Message actions" className="inset-bs-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <ThreadItemAction label="Message actions">
                  <DotsThreeIcon size={15} weight="bold" />
                </ThreadItemAction>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <TrashIcon size={14} />
                Delete message
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ThreadItemActions>
      )}
    </ThreadItem>
  );
}

// The feed wrapper: pins the shared item into the message scroller.
function DemoFeedRow({
  message,
  onDelete,
}: {
  message: ChannelFeedSystemMessage;
  onDelete?: (id: string) => void;
}) {
  const demo = message.demo;
  if (!demo) return null;
  return (
    <ChatMessageScrollerItem messageId={message.id}>
      <DemoMessageItem
        fromName={demo.fromName}
        fromKind={demo.fromKind}
        content={demo.content}
        createdAt={message.createdAt}
        replyTo={demo.replyTo}
        buttons={demo.buttons}
        onDelete={onDelete ? () => onDelete(message.id) : undefined}
      />
    </ChatMessageScrollerItem>
  );
}

// A single feed entry, either a real task card or a synthetic system row, tagged
// with the timestamp used to interleave the two.
type FeedEntry =
  | { kind: "task"; id: string; createdAt: string; task: Task }
  | {
      kind: "system";
      id: string;
      createdAt: string;
      message: ChannelFeedSystemMessage;
    };

// The Slack-style channel feed: every task kicked off in the channel, oldest
// first, rendered as a kickoff message + task card. Multiplayer — the list is
// team-visible and polls for teammates' cards and status flips. Synthetic
// "PostHog agent" system rows (context lifecycle) are interleaved by timestamp.
export function ChannelFeedView({
  tasks,
  systemMessages,
  isLoading,
  emptyState,
  onOpenTask,
  onOpenThread,
  onDeleteDemoMessage,
}: {
  tasks: Task[];
  systemMessages?: ChannelFeedSystemMessage[];
  isLoading: boolean;
  emptyState?: React.ReactNode;
  onOpenTask: (task: Task) => void;
  onOpenThread: (task: Task) => void;
  /** Delete a dev-only demo message (its "…" menu is shown only when set). */
  onDeleteDemoMessage?: (id: string) => void;
}) {
  // Merge tasks + system rows into one chronological list. ISO timestamps sort
  // lexically, so a plain string compare is chronological.
  const entries = useMemo<FeedEntry[]>(() => {
    const merged: FeedEntry[] = [
      ...tasks.map((task) => ({
        kind: "task" as const,
        id: task.id,
        createdAt: task.created_at,
        task,
      })),
      ...(systemMessages ?? []).map((message) => ({
        kind: "system" as const,
        id: message.id,
        createdAt: message.createdAt,
        message,
      })),
    ];
    merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return merged;
  }, [tasks, systemMessages]);

  if (isLoading && entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (entries.length === 0) {
    return <div className="flex-1 overflow-y-auto">{emptyState}</div>;
  }

  const now = new Date();

  return (
    <ChatMessageScrollerProvider defaultScrollPosition="end">
      <ChatMessageScroller className="min-h-0 flex-1">
        <ChatMessageScrollerViewport>
          {/* Horizontal padding is load-bearing: ThreadItem's actions float at
              the row's top-right corner (absolute, past the row edge). Without a
              gutter they hug the scroll container and get clipped. */}
          <ChatMessageScrollerContent className="mx-auto w-full gap-0 py-4">
            {entries.map((entry, index) => {
              const previous = entries[index - 1];
              const showDayMarker =
                !previous ||
                dayKey(previous.createdAt) !== dayKey(entry.createdAt);
              return (
                <Fragment key={entry.id}>
                  {showDayMarker && (
                    <ChatMarker variant="separator">
                      <ChatMarkerContent>
                        {dayLabel(entry.createdAt, now)}
                      </ChatMarkerContent>
                    </ChatMarker>
                  )}
                  {entry.kind === "task" ? (
                    <FeedRow
                      task={entry.task}
                      onOpenTask={onOpenTask}
                      onOpenThread={onOpenThread}
                    />
                  ) : entry.message.demo ? (
                    <DemoFeedRow
                      message={entry.message}
                      onDelete={onDeleteDemoMessage}
                    />
                  ) : (
                    <SystemFeedRow message={entry.message} />
                  )}
                </Fragment>
              );
            })}
          </ChatMessageScrollerContent>
        </ChatMessageScrollerViewport>
        <ChatMessageScrollerButton />
      </ChatMessageScroller>
    </ChatMessageScrollerProvider>
  );
}
