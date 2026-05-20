import crypto from "node:crypto";
import { POSTHOG_NOTIFICATIONS } from "@posthog/shared";
import { inject, injectable } from "inversify";
import type { TaskRun, TaskRunStatus } from "../../../shared/types";
import type {
  AcpMessage,
  JsonRpcMessage,
  StoredLogEntry,
} from "../../../shared/types/session-events";
import type { FeedbackEventRepository } from "../../db/repositories/feedback-event-repository";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { GitService } from "../git/service";
import type { CloudTaskClient } from "./cloud-task-client";
import type { HogletService } from "./hoglet-service";
import type { NestChatService } from "./nest-chat-service";
import type { NestService } from "./nest-service";
import type {
  FeedbackEvent,
  FeedbackEventSource,
  FeedbackProcessingState,
  InjectPromptEventPayload,
  RecordRoutedFeedbackInput,
} from "./schemas";
import { stringifyError } from "./utils";
import { UNTRUSTED_CONTENT_PREFACE, wrapUntrusted } from "./wrap-untrusted";

const MAX_COMMENT_BODY_CHARS = 2000;
const MAX_LOGIN_CHARS = 64;
const MAX_FILE_PATH_CHARS = 512;
const MAX_CI_NAME_CHARS = 256;
const MAX_CI_URL_CHARS = 512;
const MAX_BRANCH_CHARS = 256;
const HOGLET_FINAL_OUTPUT_MAX_CHARS = 30_000;
const MAX_HOGLET_SUMMARY_CHARS = 1200;
const SESSION_LOG_PAGE_LIMIT = 200;
const MAX_SESSION_LOG_PAGES_PER_POLL = 5;
// Keep the ACP buffer bounded; a very chatty turn can preserve only the tail.
const MAX_RUN_EVENT_BUFFER = 500;

const log = logger.scope("feedback-routing-service");

const POLL_INTERVAL_MS = 60_000;
const PER_TASK_DEBOUNCE_MS = 55_000;
const MAX_PARALLEL_POLLS = 4;
// Bound to keep the buffer from growing without limit if the hedgemony UI is
// never opened. Oldest entries are dropped first — the next poll cycle will
// repopulate anything that's still relevant.
const MAX_PENDING_EVENTS = 100;
const FAILING_CONCLUSIONS = new Set<string>([
  "failure",
  "timed_out",
  "action_required",
]);
const HEDGEHOG_FOLLOW_UP_FALLBACK_STATUSES = new Set<TaskRunStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export const FeedbackRoutingEvent = {
  InjectPrompt: "injectPrompt",
} as const;

export interface FeedbackRoutingEvents {
  [FeedbackRoutingEvent.InjectPrompt]: InjectPromptEventPayload;
}

interface RouteHedgehogPromptInput {
  taskId: string;
  hogletId: string;
  nestId: string;
  prompt: string;
  toolCallId: string;
  latestRunId?: string | null;
  targetRunStatus?: TaskRunStatus | null;
}

/**
 * Slice 7 of Hedgemony — the feedback router. Polls each hoglet's PR for
 * new review comments and failing check runs every {@link POLL_INTERVAL_MS}.
 * For each new item, builds a prompt with the same builders used by the
 * manual "Fix with agent" button and emits an `injectPrompt` event. A
 * renderer hook decides whether to inject into a live agent session or
 * spawn a follow-up hoglet, then calls {@link recordRoutedOutcome} to
 * commit the dedupe row.
 */
@injectable()
export class FeedbackRoutingService extends TypedEventEmitter<FeedbackRoutingEvents> {
  private started = false;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private readonly pending: InjectPromptEventPayload[] = [];
  private readonly lastPolledAt = new Map<string, number>();
  // Process-local cursors. After app restart we may replay from offset 0, which
  // is safe because nest-chat dedupes final-output and summary rows by run id.
  private readonly runLogOffsets = new Map<string, number>();
  private readonly runEventBuffers = new Map<string, AcpMessage[]>();
  private pollingNow = false;

  constructor(
    @inject(MAIN_TOKENS.HogletService)
    private readonly hoglets: HogletService,
    @inject(MAIN_TOKENS.NestService)
    private readonly nests: NestService,
    @inject(MAIN_TOKENS.GitService)
    private readonly git: GitService,
    @inject(MAIN_TOKENS.CloudTaskClient)
    private readonly cloudTasks: CloudTaskClient,
    @inject(MAIN_TOKENS.FeedbackEventRepository)
    private readonly feedbackRepo: FeedbackEventRepository,
    @inject(MAIN_TOKENS.NestChatService)
    private readonly nestChat: NestChatService,
  ) {
    super();
  }

  /** Idempotent. Starts the 60s poll. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.pollHandle = setInterval(() => {
      this.runPoll().catch((error) =>
        log.error("poll failed", { error: stringifyError(error) }),
      );
    }, POLL_INTERVAL_MS);
    log.info("FeedbackRoutingService started");
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    log.info("FeedbackRoutingService stopped");
  }

  /**
   * Drains the queue of events that were emitted before the renderer
   * subscriber attached. The renderer calls this once on mount; new events
   * after that come through the subscription channel.
   */
  consumePending(): InjectPromptEventPayload[] {
    const drained = this.pending.splice(0, this.pending.length);
    return drained;
  }

  /**
   * Records the final routing outcome after the renderer-side injection or
   * follow-up spawn completes. Promotes the previously-reserved `pending`
   * row to the final outcome (or inserts one if reservation was skipped)
   * and writes a nest-chat audit row the first time the outcome flips out
   * of `pending`. Idempotent — repeat calls just overwrite the outcome
   * without duplicating the audit message.
   */
  recordRoutedOutcome(input: RecordRoutedFeedbackInput): FeedbackEvent {
    const previous = this.feedbackRepo.findByDedupeKey({
      hogletTaskId: input.hogletTaskId,
      source: input.source,
      payloadHash: input.payloadHash,
    });
    const wasAlreadyFinalised =
      previous !== null && previous.routedOutcome !== "pending";

    const { row } = this.feedbackRepo.setOutcome({
      nestId: input.nestId,
      hogletTaskId: input.hogletTaskId,
      source: input.source,
      payloadHash: input.payloadHash,
      payloadRef: input.payloadRef,
      routedOutcome: input.routedOutcome,
      processed: input.processed,
      trustTier: input.trustTier ?? "external",
    });

    if (!wasAlreadyFinalised && input.nestId) {
      const summary = describeRoutedFeedback(input);
      const message = this.nestChat.recordHedgehogMessage({
        nestId: input.nestId,
        kind: "audit",
        body: summary,
        visibility: "summary",
        sourceTaskId: input.hogletTaskId,
        payloadJson: {
          type: "feedback_routed",
          source: input.source,
          outcome: input.routedOutcome,
          processed: input.processed ?? "unknown",
          payloadRef: input.payloadRef,
          hogletTaskId: input.hogletTaskId,
        },
      });
      this.nests.emitMessageAppended(message);
    }

    return row;
  }

  async routeHedgehogPrompt(input: RouteHedgehogPromptInput): Promise<void> {
    const payloadRef = `hedgehog-message:${input.nestId}:${input.toolCallId}`;
    const payloadHash = sha256(
      `${payloadRef}:${input.hogletId}:${input.prompt}`,
    );
    const payload: InjectPromptEventPayload = {
      taskId: input.taskId,
      hogletId: input.hogletId,
      nestId: input.nestId,
      source: "hedgehog",
      payloadRef,
      payloadHash,
      prompt: input.prompt,
      prUrl: "",
      fallbackPrompt: input.prompt,
      targetRunStatus: input.targetRunStatus ?? null,
    };

    if (!this.canDirectInjectHedgehogPrompt(input)) {
      if (this.shouldFallbackHedgehogPromptToFollowUp(input)) {
        this.tryEmitInject(payload, "internal");
        return;
      }
      if (input.targetRunStatus === "in_progress") {
        if (!this.tryReserveInject(payload, "internal")) return;
        await this.recoverHedgehogPromptRoute(input, payload, {
          attemptedRunId: input.latestRunId ?? null,
          payloadHash,
          payloadRef,
        });
        return;
      }
      this.recordRoutedOutcome({
        nestId: input.nestId,
        hogletTaskId: input.taskId,
        source: "hedgehog",
        payloadHash,
        payloadRef,
        routedOutcome: "failed",
        trustTier: "internal",
      });
      return;
    }

    if (!this.tryReserveInject(payload, "internal")) return;

    try {
      const result = await this.cloudTasks.injectPrompt({
        taskId: input.taskId,
        taskRunId: input.latestRunId,
        prompt: input.prompt,
        authoredBy: "hedgehog",
      });
      if (result.accepted) {
        this.recordHedgehogPromptOutcome(input, payloadHash, payloadRef, {
          routedOutcome: "injected",
          processed: result.processed,
        });
        return;
      }
      if (result.reason === "run_unavailable") {
        await this.recoverHedgehogPromptRoute(input, payload, {
          attemptedRunId: input.latestRunId,
          payloadHash,
          payloadRef,
        });
        return;
      }
      this.recordHedgehogPromptOutcome(input, payloadHash, payloadRef, {
        routedOutcome: "failed",
      });
    } catch (error) {
      log.warn("hedgehog prompt direct injection failed", {
        taskId: input.taskId,
        runId: input.latestRunId,
        payloadRef,
        error: stringifyError(error),
      });
      this.recordHedgehogPromptOutcome(input, payloadHash, payloadRef, {
        routedOutcome: "failed",
      });
    }
  }

  /**
   * Public so tests can drive a single poll cycle without timers. In
   * production, the interval timer in `start()` runs it.
   */
  async runPoll(): Promise<void> {
    if (this.pollingNow) return;
    this.pollingNow = true;
    try {
      const hoglets = [
        ...this.hoglets.list({ wildOnly: true }),
        ...this.nestHogletsAll(),
      ].filter((h) => h.deletedAt === null);

      const now = Date.now();
      const due = hoglets.filter((h) => {
        const last = this.lastPolledAt.get(h.taskId) ?? 0;
        return now - last >= PER_TASK_DEBOUNCE_MS;
      });

      for (let i = 0; i < due.length; i += MAX_PARALLEL_POLLS) {
        const batch = due.slice(i, i + MAX_PARALLEL_POLLS);
        await Promise.all(
          batch.map((h) =>
            this.pollHoglet(h).catch((error) =>
              log.warn("hoglet poll failed", {
                hogletId: h.id,
                taskId: h.taskId,
                error: stringifyError(error),
              }),
            ),
          ),
        );
      }
    } finally {
      this.pollingNow = false;
    }
  }

  private nestHogletsAll() {
    const nests = this.nests.list();
    return nests.flatMap((nest) => this.hoglets.list({ nestId: nest.id }));
  }

  private async pollHoglet(hoglet: {
    id: string;
    taskId: string;
    nestId: string | null;
  }): Promise<void> {
    this.lastPolledAt.set(hoglet.taskId, Date.now());

    let prUrl: string | null = null;
    try {
      const { task, latestRun } = await this.cloudTasks.getTaskWithLatestRun(
        hoglet.taskId,
      );
      const run = latestRun ?? task.latest_run ?? null;
      await this.recordCloudLogHogletTurns(hoglet, run);
      this.recordTerminalRunHogletSummary(hoglet, run);

      const candidate = extractTaskRunPrUrl(run?.output ?? null);
      if (typeof candidate === "string" && candidate.length > 0) {
        prUrl = candidate;
      }
    } catch (error) {
      log.debug("cloud task fetch failed during poll", {
        taskId: hoglet.taskId,
        error: stringifyError(error),
      });
      return;
    }
    if (!prUrl) return;

    const status = await this.git.getPrDetailsByUrl(prUrl);
    if (!status || status.merged) {
      // Merged/closed PRs still allow follow-up spawns from the renderer
      // hook, but we don't actively poll for new comments on them — those
      // become the operator's responsibility.
      return;
    }

    await this.pollPrReviewComments(hoglet, prUrl);
    await this.pollPrCheckRuns(hoglet, prUrl);
  }

  private async recordCloudLogHogletTurns(
    hoglet: { id: string; taskId: string; nestId: string | null },
    latestRun: Pick<TaskRun, "id"> | null,
  ): Promise<void> {
    if (!hoglet.nestId) return;
    if (!latestRun?.id) return;

    const runKey = `${hoglet.taskId}:${latestRun.id}`;
    const newEntries: StoredLogEntry[] = [];
    let offset = this.runLogOffsets.get(runKey) ?? 0;

    for (let page = 0; page < MAX_SESSION_LOG_PAGES_PER_POLL; page += 1) {
      let result: Awaited<ReturnType<CloudTaskClient["getTaskRunSessionLogs"]>>;
      try {
        result = await this.cloudTasks.getTaskRunSessionLogs({
          taskId: hoglet.taskId,
          runId: latestRun.id,
          offset,
          limit: SESSION_LOG_PAGE_LIMIT,
        });
      } catch (error) {
        log.debug("cloud task session logs fetch failed during poll", {
          hogletId: hoglet.id,
          taskId: hoglet.taskId,
          runId: latestRun.id,
          offset,
          error: stringifyError(error),
        });
        return;
      }

      newEntries.push(...result.entries);
      offset += result.entries.length;
      if (!result.hasMore || result.entries.length === 0) break;
    }

    if (newEntries.length === 0) return;
    this.runLogOffsets.set(runKey, offset);

    const newEvents = newEntries.map(storedEntryToAcpMessage);
    const buffer = [
      ...(this.runEventBuffers.get(runKey) ?? []),
      ...newEvents,
    ].slice(-MAX_RUN_EVENT_BUFFER);
    this.runEventBuffers.set(runKey, buffer);

    const turns = extractHogletTurns(buffer);
    if (turns.length === 0) return;

    for (const turn of turns) {
      try {
        const { message, created } = this.nestChat.recordHogletMessage({
          nestId: hoglet.nestId,
          hogletId: hoglet.id,
          taskId: hoglet.taskId,
          runId: latestRun.id,
          turnIndex: turn.turnIndex,
          body: truncateFinalOutput(turn.text),
          stopReason: turn.stopReason,
        });
        if (created) {
          this.nests.emitMessageAppended(message);
        }
      } catch (error) {
        log.warn("failed to record hoglet message from cloud logs", {
          hogletId: hoglet.id,
          taskId: hoglet.taskId,
          runId: latestRun.id,
          turnIndex: turn.turnIndex,
          error: stringifyError(error),
        });
      }
    }
  }

  private recordTerminalRunHogletSummary(
    hoglet: { id: string; taskId: string; nestId: string | null },
    latestRun: Pick<
      TaskRun,
      "id" | "status" | "output" | "branch" | "error_message"
    > | null,
  ): void {
    if (!hoglet.nestId) return;
    if (!latestRun || !isSummaryWorthyTerminalStatus(latestRun.status)) return;

    const body = extractTerminalRunSummary(latestRun);
    if (!body) return;

    try {
      const { message, created } = this.nestChat.recordHogletSummary({
        nestId: hoglet.nestId,
        hogletId: hoglet.id,
        taskId: hoglet.taskId,
        runId: latestRun.id,
        terminalReason: latestRun.status,
        body,
      });
      if (created) {
        this.nests.emitMessageAppended(message);
      }
    } catch (error) {
      log.warn("failed to record hoglet summary", {
        hogletId: hoglet.id,
        taskId: hoglet.taskId,
        runId: latestRun.id,
        error: stringifyError(error),
      });
    }
  }

  private async pollPrReviewComments(
    hoglet: { id: string; taskId: string; nestId: string | null },
    prUrl: string,
  ): Promise<void> {
    let comments: Awaited<ReturnType<GitService["getPrReviewComments"]>>;
    try {
      comments = await this.git.getPrReviewComments(prUrl);
    } catch (error) {
      log.debug("getPrReviewComments failed", {
        prUrl,
        error: stringifyError(error),
      });
      return;
    }

    for (const comment of comments) {
      if (comment.line === null && comment.original_line === null) continue;
      const line = comment.line ?? comment.original_line ?? 0;
      const side: "old" | "new" = comment.side === "LEFT" ? "old" : "new";
      const payloadRef = `pr-comment:${comment.id}`;
      const payloadHash = sha256(`${comment.id}:${comment.body}`);

      const prompt = buildPrCommentPrompt(
        comment.path,
        line,
        side,
        comment.body,
        comment.user.login,
      );
      const fallbackPrompt = buildFollowUpPrompt(
        prUrl,
        `review comment from @${comment.user.login} on ${comment.path}:${line}`,
        comment.body,
      );

      this.tryEmitInject({
        taskId: hoglet.taskId,
        hogletId: hoglet.id,
        nestId: hoglet.nestId,
        source: "pr_review",
        payloadRef,
        payloadHash,
        prompt,
        prUrl,
        fallbackPrompt,
      });
    }
  }

  private async pollPrCheckRuns(
    hoglet: { id: string; taskId: string; nestId: string | null },
    prUrl: string,
  ): Promise<void> {
    let checks: Awaited<ReturnType<GitService["getPrCheckRuns"]>>;
    try {
      checks = await this.git.getPrCheckRuns(prUrl);
    } catch (error) {
      log.debug("getPrCheckRuns failed", {
        prUrl,
        error: stringifyError(error),
      });
      return;
    }

    for (const check of checks) {
      if (check.status !== "completed") continue;
      if (!check.conclusion || !FAILING_CONCLUSIONS.has(check.conclusion)) {
        continue;
      }

      const payloadRef = `ci:${check.id}`;
      const payloadHash = sha256(
        `${check.id}:${check.conclusion}:${check.completedAt ?? ""}`,
      );

      const prompt = buildCiFailurePrompt(
        check.name,
        check.conclusion,
        check.htmlUrl,
      );
      const fallbackPrompt = buildFollowUpPrompt(
        prUrl,
        `CI failure '${check.name}' (${check.conclusion})`,
        `See ${check.htmlUrl}`,
      );

      this.tryEmitInject({
        taskId: hoglet.taskId,
        hogletId: hoglet.id,
        nestId: hoglet.nestId,
        source: "ci",
        payloadRef,
        payloadHash,
        prompt,
        prUrl,
        fallbackPrompt,
      });
    }
  }

  /**
   * Reserves a `pending` dedupe row in sqlite, then emits the inject event
   * (or queues it for the renderer subscriber). The reservation closes the
   * check-then-emit race: a second poll cycle that lands before
   * `recordRoutedOutcome` runs still sees the pending row and skips
   * re-emitting. Returns `false` if the slot was already reserved.
   */
  private tryEmitInject(
    payload: InjectPromptEventPayload,
    trustTier: "internal" | "external" = "external",
  ): boolean {
    if (!this.tryReserveInject(payload, trustTier)) return false;
    this.emitInject(payload);
    return true;
  }

  private tryReserveInject(
    payload: InjectPromptEventPayload,
    trustTier: "internal" | "external",
  ): boolean {
    const { reserved } = this.feedbackRepo.tryReservePending({
      nestId: payload.nestId,
      hogletTaskId: payload.taskId,
      source: payload.source,
      payloadHash: payload.payloadHash,
      payloadRef: payload.payloadRef,
      trustTier,
    });
    return reserved;
  }

  private emitInject(payload: InjectPromptEventPayload): void {
    const hasListeners =
      this.listenerCount(FeedbackRoutingEvent.InjectPrompt) > 0;
    if (hasListeners) {
      this.emit(FeedbackRoutingEvent.InjectPrompt, payload);
      return;
    }
    this.pending.push(payload);
    if (this.pending.length > MAX_PENDING_EVENTS) {
      const dropped = this.pending.shift();
      log.warn("pending injectPrompt queue full, dropped oldest", {
        cap: MAX_PENDING_EVENTS,
        droppedPayloadRef: dropped?.payloadRef,
      });
    }
  }

  private canDirectInjectHedgehogPrompt(
    input: RouteHedgehogPromptInput,
  ): input is RouteHedgehogPromptInput & { latestRunId: string } {
    return Boolean(
      input.latestRunId && input.targetRunStatus === "in_progress",
    );
  }

  private shouldFallbackHedgehogPromptToFollowUp(
    input: RouteHedgehogPromptInput,
  ): boolean {
    return Boolean(
      input.nestId &&
        input.targetRunStatus &&
        HEDGEHOG_FOLLOW_UP_FALLBACK_STATUSES.has(input.targetRunStatus),
    );
  }

  private async recoverHedgehogPromptRoute(
    input: RouteHedgehogPromptInput,
    payload: InjectPromptEventPayload,
    route: {
      attemptedRunId: string | null;
      payloadHash: string;
      payloadRef: string;
    },
  ): Promise<void> {
    try {
      const { latestRun } = await this.cloudTasks.getTaskWithLatestRun(
        input.taskId,
      );
      const latestStatus = latestRun?.status ?? null;
      const latestRunId = latestRun?.id ?? null;

      if (
        latestStatus === "in_progress" &&
        latestRunId &&
        latestRunId !== route.attemptedRunId
      ) {
        const retry = await this.cloudTasks.injectPrompt({
          taskId: input.taskId,
          taskRunId: latestRunId,
          prompt: input.prompt,
          authoredBy: "hedgehog",
        });
        this.recordHedgehogPromptOutcome(
          input,
          route.payloadHash,
          route.payloadRef,
          {
            routedOutcome: retry.accepted ? "injected" : "failed",
            processed: retry.accepted ? retry.processed : undefined,
          },
        );
        return;
      }

      if (
        latestStatus &&
        HEDGEHOG_FOLLOW_UP_FALLBACK_STATUSES.has(latestStatus)
      ) {
        this.emitInject({
          ...payload,
          targetRunStatus: latestStatus,
        });
        return;
      }

      this.recordHedgehogPromptOutcome(
        input,
        route.payloadHash,
        route.payloadRef,
        {
          routedOutcome: "failed",
        },
      );
    } catch (error) {
      log.warn("hedgehog prompt recovery failed", {
        taskId: input.taskId,
        attemptedRunId: route.attemptedRunId,
        payloadRef: route.payloadRef,
        error: stringifyError(error),
      });
      this.recordHedgehogPromptOutcome(
        input,
        route.payloadHash,
        route.payloadRef,
        {
          routedOutcome: "failed",
        },
      );
    }
  }

  private recordHedgehogPromptOutcome(
    input: RouteHedgehogPromptInput,
    payloadHash: string,
    payloadRef: string,
    outcome: {
      routedOutcome: "injected" | "failed";
      processed?: FeedbackProcessingState;
    },
  ): void {
    this.recordRoutedOutcome({
      nestId: input.nestId,
      hogletTaskId: input.taskId,
      source: "hedgehog",
      payloadHash,
      payloadRef,
      routedOutcome: outcome.routedOutcome,
      processed: outcome.processed,
      trustTier: "internal",
    });
  }
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function buildPrCommentPrompt(
  filePath: string,
  line: number,
  side: "old" | "new",
  body: string,
  login: string,
): string {
  const truncatedPath = filePath.slice(0, MAX_FILE_PATH_CHARS);
  const escapedPath = escapeXmlAttr(truncatedPath);
  const wrappedLogin = wrapUntrusted(login, {
    source: "pr_review:login",
    maxChars: MAX_LOGIN_CHARS,
  });
  const wrappedBody = wrapUntrusted(body, {
    source: "pr_review:body",
    maxChars: MAX_COMMENT_BODY_CHARS,
  });
  return `${UNTRUSTED_CONTENT_PREFACE}\n\nFix the PR review comment on <file path="${escapedPath}" />, line ${line} (${side}). The comment author and body follow:\n\nAuthor:\n${wrappedLogin}\n\nBody:\n${wrappedBody}`;
}

function buildCiFailurePrompt(
  name: string,
  conclusion: string,
  htmlUrl: string,
): string {
  const wrappedName = wrapUntrusted(name, {
    source: "ci:check_name",
    maxChars: MAX_CI_NAME_CHARS,
  });
  const safeUrl = isHttpsGithubUrl(htmlUrl)
    ? htmlUrl.slice(0, MAX_CI_URL_CHARS)
    : "(invalid CI URL)";
  return `${UNTRUSTED_CONTENT_PREFACE}\n\nA CI check failed on this PR (conclusion: ${conclusion}). The check name is external content:\n\n${wrappedName}\n\nDetails: ${safeUrl}\n\nPlease diagnose the failure and push a fix.`;
}

function buildFollowUpPrompt(
  prUrl: string,
  context: string,
  body: string,
): string {
  const safePrUrl = isHttpsGithubUrl(prUrl) ? prUrl : "(invalid PR URL)";
  const wrappedContext = wrapUntrusted(context, {
    source: "followup:context",
    maxChars: MAX_COMMENT_BODY_CHARS,
  });
  const wrappedBody = wrapUntrusted(body, {
    source: "followup:body",
    maxChars: MAX_COMMENT_BODY_CHARS,
  });
  return `${UNTRUSTED_CONTENT_PREFACE}\n\nThe parent PR (${safePrUrl}) is no longer in an open agent session. New feedback arrived:\n\nContext:\n${wrappedContext}\n\nBody:\n${wrappedBody}\n\nOpen a follow-up PR addressing this.`;
}

function isHttpsGithubUrl(url: string): boolean {
  if (url.length === 0 || url.length > MAX_CI_URL_CHARS) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return parsed.host === "github.com" || parsed.host.endsWith(".github.com");
  } catch {
    return false;
  }
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isSummaryWorthyTerminalStatus(
  status: TaskRunStatus,
): status is "completed" | "failed" | "cancelled" {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function extractTerminalRunSummary(
  run: Pick<TaskRun, "status" | "output" | "branch" | "error_message">,
): string {
  if (run.status === "failed") {
    const message = run.error_message?.trim();
    return message ? `Run failed: ${truncateSummary(message)}` : "Run failed.";
  }

  if (run.status === "cancelled") {
    return "Run cancelled.";
  }

  const prUrl = extractTaskRunPrUrl(run.output);
  if (prUrl) {
    return `Run completed and produced a pull request: ${prUrl}`;
  }

  const branch = extractTaskRunBranch(run.output) ?? run.branch;
  if (branch) {
    return `Run completed on branch: ${branch.slice(0, MAX_BRANCH_CHARS)}`;
  }

  return "Run completed without structured output. Review the task before deciding whether follow-up work is needed.";
}

/**
 * Current agent/cloud paths write task-run output as direct metadata
 * (`{ pr_url }`, `{ head_branch }`), while structured-output runs can be
 * wrapped as `{ output: ... }` by the cloud runner. Keep this extraction pinned
 * to those observed shapes; prose deliverables are surfaced from nest chat.
 */
function extractTaskRunPrUrl(
  output: Record<string, unknown> | null,
): string | null {
  if (!output) return null;

  const direct = output.pr_url;
  if (typeof direct === "string" && isHttpsGithubUrl(direct)) return direct;

  const nested = output.output;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedPrUrl = (nested as Record<string, unknown>).pr_url;
    if (typeof nestedPrUrl === "string" && isHttpsGithubUrl(nestedPrUrl)) {
      return nestedPrUrl;
    }
  }

  return null;
}

function extractTaskRunBranch(
  output: Record<string, unknown> | null,
): string | null {
  if (!output) return null;

  const direct = firstString(output, ["head_branch", "branch"]);
  if (direct) return direct;

  const nested = output.output;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return firstString(nested as Record<string, unknown>, [
      "head_branch",
      "branch",
    ]);
  }

  return null;
}

function firstString(
  source: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function storedEntryToAcpMessage(entry: StoredLogEntry): AcpMessage {
  return {
    type: "acp_message",
    ts: entry.timestamp ? Date.parse(entry.timestamp) : Date.now(),
    message: (entry.notification ?? {}) as JsonRpcMessage,
  };
}

interface ExtractedHogletTurn {
  turnIndex: number;
  text: string;
  stopReason: string;
}

function extractHogletTurns(events: AcpMessage[]): ExtractedHogletTurn[] {
  const turns: ExtractedHogletTurn[] = [];
  let turnIndex = 0;
  let currentSegments: string[] = [];

  for (const event of events) {
    const message = event.message;
    if (
      typeof message !== "object" ||
      message === null ||
      !("method" in message) ||
      typeof message.method !== "string"
    ) {
      continue;
    }

    if (message.method === POSTHOG_NOTIFICATIONS.TURN_COMPLETE) {
      const params = message.params as { stopReason?: unknown } | undefined;
      const stopReason =
        typeof params?.stopReason === "string" ? params.stopReason : "end_turn";
      const nonEmpty = currentSegments.filter((segment) => segment.length > 0);
      if (nonEmpty.length > 0) {
        const text = nonEmpty.join("\n\n").trim();
        if (text.length > 0) {
          turns.push({ turnIndex, text, stopReason });
        }
      }
      turnIndex += 1;
      currentSegments = [];
      continue;
    }

    if (message.method !== "session/update") continue;

    const params = message.params as
      | {
          update?: {
            sessionUpdate?: unknown;
            content?: { type?: unknown; text?: unknown };
            message?: unknown;
          };
        }
      | undefined;
    const update = params?.update;
    if (!update || update.sessionUpdate !== "agent_message") continue;

    const text =
      typeof update.content?.text === "string"
        ? update.content.text
        : typeof update.message === "string"
          ? update.message
          : null;
    if (text && text.length > 0) {
      currentSegments.push(text);
    }
  }

  return turns;
}

function truncateFinalOutput(body: string): string {
  if (body.length <= HOGLET_FINAL_OUTPUT_MAX_CHARS) return body;
  const suffix = "\n\n[Final output truncated for nest chat.]";
  return `${body.slice(0, HOGLET_FINAL_OUTPUT_MAX_CHARS - suffix.length)}${suffix}`;
}

function truncateSummary(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= MAX_HOGLET_SUMMARY_CHARS) return singleLine;
  return `${singleLine.slice(0, MAX_HOGLET_SUMMARY_CHARS)}… (truncated)`;
}

function outcomeLabel(input: RecordRoutedFeedbackInput): string {
  if (input.routedOutcome === "injected") {
    if (input.source !== "hedgehog") return "→ injected into live session";
    if (input.processed === "active") {
      return "→ delivered to cloud run (active turn)";
    }
    if (input.processed === "queued") {
      return "→ delivered to cloud run (queued; will be read at next turn boundary)";
    }
    return "→ delivered to cloud run";
  }
  if (input.routedOutcome === "follow_up_spawned") {
    return "→ spawned a follow-up hoglet";
  }
  if (input.routedOutcome === "failed") {
    return input.source === "hedgehog"
      ? "→ could not deliver: the hoglet's cloud run is not currently accepting messages. Wait for the run to advance or for its hoglet summary, then retry only if the question is still useful."
      : "→ no active session, no nest; logged only";
  }
  return "";
}

function describeRoutedFeedback(input: RecordRoutedFeedbackInput): string {
  const sourceLabel: Record<FeedbackEventSource, string> = {
    pr_review: "PR review comment",
    ci: "CI failure",
    issue: "issue update",
    hedgehog: "hedgehog message",
  };
  return `Routed ${sourceLabel[input.source]} ${outcomeLabel(input)} (ref: ${input.payloadRef}).`;
}
