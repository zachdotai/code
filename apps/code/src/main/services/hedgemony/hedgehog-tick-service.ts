import { inject, injectable } from "inversify";
import type { HedgehogStateRepository } from "../../db/repositories/hedgehog-state-repository";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type {
  AnthropicToolUseBlock,
  PromptWithToolsOutput,
} from "../llm-gateway/schemas";
import type { LlmGatewayService } from "../llm-gateway/service";
import type { CloudTaskClient } from "./cloud-task-client";
import {
  appendScratchpad,
  buildUserPrompt,
  HEDGEHOG_SYSTEM_PROMPT,
  type HogletWithState,
  type ScratchpadEntry,
} from "./hedgehog-prompts";
import {
  HEDGEHOG_TOOLS,
  type HedgehogToolName,
  killHogletArgs,
  messageHogletArgs,
  raiseHogletArgs,
  writeAuditEntryArgs,
} from "./hedgehog-tools";
import type { HogletService } from "./hoglet-service";
import type { NestChatService } from "./nest-chat-service";
import type { NestService } from "./nest-service";
import {
  HedgemonyEvent,
  type Hoglet,
  type HogletChangedEvent,
  type Nest,
  type NestChangedEvent,
} from "./schemas";

const log = logger.scope("hedgehog-tick-service");

const MIN_TICK_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
const MAX_RAISE_CALLS_PER_TICK = 3;
const HEDGEHOG_MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 2_000;

interface TickContext {
  nest: Nest;
  hoglets: HogletWithState[];
}

/**
 * Slice 6 of Hedgemony — the hedgehog. A per-nest ephemeral orchestrator that
 * ticks on (heartbeat | new hoglet event | operator chat message), assembles
 * fresh context from sqlite, calls Claude with the constrained tool list, and
 * dispatches each tool_use block back to a service method. State persists in
 * `hedgemony_hedgehog_state` so force-quit mid-tick recovers cleanly.
 *
 * NOT a Task. NOT a long-running agent. The service singleton owns the
 * scheduler and dispatch; each tick is a one-shot function over `(nest,
 * hoglets, recent chat, scratchpad)`.
 */
@injectable()
export class HedgehogTickService {
  private started = false;
  private readonly inFlight = new Set<string>();
  private readonly lastEnqueuedAt = new Map<string, number>();
  private heartbeatHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    @inject(MAIN_TOKENS.LlmGatewayService)
    private readonly llm: LlmGatewayService,
    @inject(MAIN_TOKENS.NestService)
    private readonly nestService: NestService,
    @inject(MAIN_TOKENS.HogletService)
    private readonly hogletService: HogletService,
    @inject(MAIN_TOKENS.NestChatService)
    private readonly nestChat: NestChatService,
    @inject(MAIN_TOKENS.HedgehogStateRepository)
    private readonly stateRepo: HedgehogStateRepository,
    @inject(MAIN_TOKENS.CloudTaskClient)
    private readonly cloudTasks: CloudTaskClient,
  ) {}

  /**
   * Idempotent. Subscribes to nest/hoglet events, starts the heartbeat, and
   * resets any DB rows stuck in `ticking` (left over from a force-quit).
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Reset any `ticking` rows from a previous boot so we don't render a
    // stuck glow forever.
    const reset = this.stateRepo.resetStuckTicks();
    for (const row of reset) {
      this.nestService.emitHedgehogTick(row.nestId, {
        state: "idle",
        lastTickAt: row.lastTickAt,
      });
    }

    this.nestService.on(HedgemonyEvent.NestChanged, (data) =>
      this.handleNestEvent(data),
    );
    this.hogletService.on(HedgemonyEvent.HogletChanged, (data) =>
      this.handleHogletEvent(data),
    );

    this.heartbeatHandle = setInterval(() => {
      this.runHeartbeat().catch((error) =>
        log.error("heartbeat tick failed", { error }),
      );
    }, HEARTBEAT_INTERVAL_MS);

    log.info("HedgehogTickService started");
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.heartbeatHandle) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
    log.info("HedgehogTickService stopped");
  }

  /**
   * Schedule a tick for `nestId`. Debounces within `MIN_TICK_INTERVAL_MS`,
   * no-ops if a tick is already in flight. Returns the (fire-and-forget)
   * promise for tests and callers that want to await completion.
   */
  enqueueTick(nestId: string, reason: string): Promise<void> {
    if (!this.started) {
      // Allow direct calls from tests without start().
      log.debug("enqueueTick before start()", { nestId, reason });
    }
    const now = Date.now();
    const last = this.lastEnqueuedAt.get(nestId) ?? 0;
    if (now - last < MIN_TICK_INTERVAL_MS) {
      log.debug("tick debounced", {
        nestId,
        reason,
        elapsedMs: now - last,
      });
      return Promise.resolve();
    }
    if (this.inFlight.has(nestId)) {
      log.debug("tick already in flight", { nestId, reason });
      return Promise.resolve();
    }
    this.lastEnqueuedAt.set(nestId, now);
    return this.runTick(nestId, reason).catch((error) => {
      log.error("tick failed", { nestId, reason, error });
    });
  }

  private handleNestEvent(data: NestChangedEvent): void {
    const event = data.event;
    if (event.kind === "message_appended") {
      if (event.message.kind === "user_message") {
        // Operator chat → trigger tick.
        void this.enqueueTick(data.nestId, "operator_chat");
      }
      return;
    }
    if (event.kind === "status" && event.nest.status === "active") {
      // Newly created/unarchived → kick off an initial tick.
      void this.enqueueTick(data.nestId, "nest_status_active");
    }
  }

  private handleHogletEvent(data: HogletChangedEvent): void {
    if (data.bucket.kind !== "nest") return;
    // Adoption / release inside a nest is a good trigger.
    void this.enqueueTick(data.bucket.nestId, "hoglet_roster_changed");
  }

  private async runHeartbeat(): Promise<void> {
    const activeNests = this.nestService
      .list()
      .filter((n) => n.status === "active");
    for (const nest of activeNests) {
      const state = this.stateRepo.findByNestId(nest.id);
      const last = state?.lastTickAt ? new Date(state.lastTickAt).getTime() : 0;
      if (Date.now() - last < HEARTBEAT_INTERVAL_MS) continue;
      await this.enqueueTick(nest.id, "heartbeat");
    }
  }

  private async runTick(nestId: string, reason: string): Promise<void> {
    if (this.inFlight.has(nestId)) return;
    this.inFlight.add(nestId);
    try {
      await this.tick(nestId, reason);
    } finally {
      this.inFlight.delete(nestId);
    }
  }

  /**
   * The full tick lifecycle. Public for tests; production callers should use
   * `enqueueTick` so debouncing and the in-flight lock apply.
   */
  async tick(nestId: string, reason: string): Promise<void> {
    const nest = (() => {
      try {
        return this.nestService.get({ id: nestId });
      } catch {
        return null;
      }
    })();
    if (!nest || nest.status !== "active") {
      log.debug("tick skipped — nest missing or inactive", { nestId });
      return;
    }

    // Move state → ticking, emit so the glow turns on.
    this.stateRepo.upsert({ nestId, state: "ticking" });
    this.nestService.emitHedgehogTick(nestId, {
      state: "ticking",
      lastTickAt: this.stateRepo.findByNestId(nestId)?.lastTickAt ?? null,
    });

    const newScratchpadEntries: ScratchpadEntry[] = [];
    let raiseCount = 0;

    try {
      const context = await this.buildContext(nest);
      const recentChat = this.nestChat.list({ nestId, detail: false });
      const scratchpad = this.loadScratchpad(nestId);
      const userPrompt = buildUserPrompt({
        nest,
        hoglets: context.hoglets,
        recentChat,
        scratchpad,
        triggerReason: reason,
      });

      const response = await this.llm.promptWithTools(
        [{ role: "user", content: userPrompt }],
        {
          system: HEDGEHOG_SYSTEM_PROMPT,
          maxTokens: MAX_TOKENS,
          model: HEDGEHOG_MODEL,
          tools: HEDGEHOG_TOOLS,
          toolChoice: { type: "auto" },
        },
      );

      newScratchpadEntries.push(...this.summariseLlmResponse(reason, response));

      for (const block of response.toolUseBlocks) {
        const result = await this.dispatchTool(context, block, raiseCount);
        if (block.name === "raise_hoglet" && result.success) {
          raiseCount += 1;
        }
        newScratchpadEntries.push({
          ts: new Date().toISOString(),
          kind: "decision",
          summary: result.scratchpadSummary,
        });
      }

      // Free-form text from the model also gets a single scratchpad note so
      // the next tick can see her reasoning.
      const combinedText = response.textBlocks
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .join("\n");
      if (combinedText.length > 0) {
        this.writeNestMessage(nestId, {
          kind: "hedgehog_message",
          body: combinedText,
          visibility: "summary",
          payloadJson: { tickReason: reason, stopReason: response.stopReason },
        });
      }
    } catch (error) {
      log.error("tick body errored", { nestId, reason, error });
      newScratchpadEntries.push({
        ts: new Date().toISOString(),
        kind: "observation",
        summary: `Tick errored: ${stringifyError(error)}`,
      });
      this.writeNestMessage(nestId, {
        kind: "audit",
        body: `Hedgehog tick errored: ${stringifyError(error)}`,
        visibility: "summary",
        payloadJson: { tickReason: reason, type: "tick_error" },
      });
    } finally {
      const scratchpad = this.loadScratchpad(nestId);
      const nextScratchpad = appendScratchpad(scratchpad, newScratchpadEntries);
      const lastTickAt = new Date().toISOString();
      this.stateRepo.upsert({
        nestId,
        state: "idle",
        lastTickAt,
        serializedStateJson: JSON.stringify({ scratchpad: nextScratchpad }),
      });
      this.nestService.emitHedgehogTick(nestId, {
        state: "idle",
        lastTickAt,
      });
    }
  }

  private async dispatchTool(
    context: TickContext,
    block: AnthropicToolUseBlock,
    raiseCount: number,
  ): Promise<{ success: boolean; scratchpadSummary: string }> {
    const toolName = block.name as HedgehogToolName;
    switch (toolName) {
      case "raise_hoglet":
        return this.handleRaiseHoglet(context, block, raiseCount);
      case "kill_hoglet":
        return this.handleKillHoglet(context, block);
      case "message_hoglet":
        return this.handleMessageHoglet(context, block);
      case "write_audit_entry":
        return this.handleWriteAuditEntry(context, block);
      default:
        log.warn("unknown tool name from hedgehog", { name: block.name });
        return {
          success: false,
          scratchpadSummary: `Ignored unknown tool ${block.name}`,
        };
    }
  }

  private async handleRaiseHoglet(
    context: TickContext,
    block: AnthropicToolUseBlock,
    raiseCount: number,
  ): Promise<{ success: boolean; scratchpadSummary: string }> {
    if (raiseCount >= MAX_RAISE_CALLS_PER_TICK) {
      this.writeNestMessage(context.nest.id, {
        kind: "audit",
        body: `Hedgehog tried to raise another hoglet but per-tick cap (${MAX_RAISE_CALLS_PER_TICK}) was reached.`,
        payloadJson: { type: "raise_capped", attempted: block.input },
      });
      return { success: false, scratchpadSummary: "raise_hoglet capped" };
    }
    const parsed = raiseHogletArgs.safeParse(block.input);
    if (!parsed.success) {
      return this.recordToolValidationError(
        context.nest.id,
        "raise_hoglet",
        parsed.error.message,
      );
    }
    const args = parsed.data;
    const entry = context.hoglets.find((h) => h.hoglet.id === args.hoglet_id);
    if (!entry) {
      return this.recordToolValidationError(
        context.nest.id,
        "raise_hoglet",
        `hoglet ${args.hoglet_id} not in this nest`,
      );
    }
    if (
      entry.taskRunStatus === "in_progress" ||
      entry.taskRunStatus === "queued"
    ) {
      this.writeNestMessage(context.nest.id, {
        kind: "audit",
        body: `Skipped raising hoglet ${args.hoglet_id}: latest run is ${entry.taskRunStatus}.`,
        payloadJson: { type: "raise_skipped_active", hogletId: args.hoglet_id },
      });
      return {
        success: false,
        scratchpadSummary: `raise_hoglet skipped (${entry.taskRunStatus})`,
      };
    }

    try {
      const run = await this.cloudTasks.createTaskRun(entry.hoglet.taskId, {
        environment: "cloud",
        mode: "background",
      });
      await this.cloudTasks.startTaskRun(entry.hoglet.taskId, run.id, {
        pendingUserMessage: args.prompt,
      });
      this.writeNestMessage(context.nest.id, {
        kind: "audit",
        sourceTaskId: entry.hoglet.taskId,
        body: `Raised hoglet ${args.hoglet_id}${args.prompt ? ` with prompt: ${truncate(args.prompt, 200)}` : ""}.`,
        payloadJson: {
          type: "raised_hoglet",
          hogletId: args.hoglet_id,
          taskId: entry.hoglet.taskId,
          taskRunId: run.id,
          prompt: args.prompt ?? null,
        },
      });
      return {
        success: true,
        scratchpadSummary: `Raised hoglet ${args.hoglet_id}`,
      };
    } catch (error) {
      this.writeNestMessage(context.nest.id, {
        kind: "audit",
        body: `Failed to raise hoglet ${args.hoglet_id}: ${stringifyError(error)}.`,
        payloadJson: {
          type: "raise_failed",
          hogletId: args.hoglet_id,
          error: stringifyError(error),
        },
      });
      return {
        success: false,
        scratchpadSummary: `raise_hoglet errored: ${stringifyError(error)}`,
      };
    }
  }

  private async handleKillHoglet(
    context: TickContext,
    block: AnthropicToolUseBlock,
  ): Promise<{ success: boolean; scratchpadSummary: string }> {
    const parsed = killHogletArgs.safeParse(block.input);
    if (!parsed.success) {
      return this.recordToolValidationError(
        context.nest.id,
        "kill_hoglet",
        parsed.error.message,
      );
    }
    const args = parsed.data;
    const entry = context.hoglets.find((h) => h.hoglet.id === args.hoglet_id);
    if (!entry) {
      return this.recordToolValidationError(
        context.nest.id,
        "kill_hoglet",
        `hoglet ${args.hoglet_id} not in this nest`,
      );
    }
    if (
      entry.taskRunStatus === "completed" ||
      entry.taskRunStatus === "failed" ||
      entry.taskRunStatus === "cancelled" ||
      entry.taskRunStatus === "no_run"
    ) {
      this.writeNestMessage(context.nest.id, {
        kind: "audit",
        body: `Skipped killing hoglet ${args.hoglet_id}: not currently active (${entry.taskRunStatus}).`,
        payloadJson: {
          type: "kill_skipped_inactive",
          hogletId: args.hoglet_id,
        },
      });
      return {
        success: false,
        scratchpadSummary: `kill_hoglet skipped (already ${entry.taskRunStatus})`,
      };
    }
    if (!entry.latestRunId) {
      this.writeNestMessage(context.nest.id, {
        kind: "audit",
        body: `Cannot kill hoglet ${args.hoglet_id}: no latest_run_id resolved.`,
        payloadJson: {
          type: "kill_no_run_id",
          hogletId: args.hoglet_id,
        },
      });
      return {
        success: false,
        scratchpadSummary: "kill_hoglet missing latest_run_id",
      };
    }

    try {
      await this.cloudTasks.updateTaskRun(
        entry.hoglet.taskId,
        entry.latestRunId,
        { status: "cancelled" },
      );
      this.writeNestMessage(context.nest.id, {
        kind: "audit",
        sourceTaskId: entry.hoglet.taskId,
        body: `Killed hoglet ${args.hoglet_id}: ${args.reason}`,
        payloadJson: {
          type: "killed_hoglet",
          hogletId: args.hoglet_id,
          reason: args.reason,
        },
      });
      return {
        success: true,
        scratchpadSummary: `Killed hoglet ${args.hoglet_id}: ${args.reason}`,
      };
    } catch (error) {
      this.writeNestMessage(context.nest.id, {
        kind: "audit",
        body: `Failed to kill hoglet ${args.hoglet_id}: ${stringifyError(error)}.`,
        payloadJson: {
          type: "kill_failed",
          hogletId: args.hoglet_id,
          error: stringifyError(error),
        },
      });
      return {
        success: false,
        scratchpadSummary: `kill_hoglet errored: ${stringifyError(error)}`,
      };
    }
  }

  private async handleMessageHoglet(
    context: TickContext,
    block: AnthropicToolUseBlock,
  ): Promise<{ success: boolean; scratchpadSummary: string }> {
    const parsed = messageHogletArgs.safeParse(block.input);
    if (!parsed.success) {
      return this.recordToolValidationError(
        context.nest.id,
        "message_hoglet",
        parsed.error.message,
      );
    }
    const args = parsed.data;
    const entry = context.hoglets.find((h) => h.hoglet.id === args.hoglet_id);
    if (!entry) {
      return this.recordToolValidationError(
        context.nest.id,
        "message_hoglet",
        `hoglet ${args.hoglet_id} not in this nest`,
      );
    }
    this.writeNestMessage(context.nest.id, {
      kind: "audit",
      sourceTaskId: entry.hoglet.taskId,
      body: `Noted message for hoglet ${args.hoglet_id}: ${truncate(args.prompt, 300)} (Slice 6 — prompt is not yet injected into the live session).`,
      payloadJson: {
        type: "message_hoglet_recorded",
        hogletId: args.hoglet_id,
        prompt: args.prompt,
      },
    });
    return {
      success: true,
      scratchpadSummary: `message_hoglet recorded for ${args.hoglet_id}`,
    };
  }

  private async handleWriteAuditEntry(
    context: TickContext,
    block: AnthropicToolUseBlock,
  ): Promise<{ success: boolean; scratchpadSummary: string }> {
    const parsed = writeAuditEntryArgs.safeParse(block.input);
    if (!parsed.success) {
      return this.recordToolValidationError(
        context.nest.id,
        "write_audit_entry",
        parsed.error.message,
      );
    }
    const { summary, detail } = parsed.data;
    this.writeNestMessage(context.nest.id, {
      kind: "audit",
      body: summary,
      payloadJson: detail ? { type: "audit_with_detail", detail } : null,
      visibility: "summary",
    });
    if (detail) {
      this.writeNestMessage(context.nest.id, {
        kind: "audit",
        body: detail,
        visibility: "detail",
        payloadJson: { type: "audit_detail" },
      });
    }
    return {
      success: true,
      scratchpadSummary: `audit: ${truncate(summary, 80)}`,
    };
  }

  private recordToolValidationError(
    nestId: string,
    toolName: string,
    error: string,
  ): { success: boolean; scratchpadSummary: string } {
    this.writeNestMessage(nestId, {
      kind: "audit",
      body: `Hedgehog tool ${toolName} rejected: ${error}`,
      payloadJson: { type: "tool_validation_error", tool: toolName, error },
    });
    return {
      success: false,
      scratchpadSummary: `${toolName} validation failed`,
    };
  }

  private async buildContext(nest: Nest): Promise<TickContext> {
    const hoglets = this.hogletService
      .list({ nestId: nest.id })
      .filter((h): h is Hoglet => !h.deletedAt);
    const enriched: HogletWithState[] = [];
    for (const hoglet of hoglets) {
      try {
        const { latestRun } = await this.cloudTasks.getTaskWithLatestRun(
          hoglet.taskId,
        );
        enriched.push({
          hoglet,
          taskRunStatus: latestRun?.status ?? "no_run",
          latestRunId: latestRun?.id ?? null,
          branch: latestRun?.branch ?? null,
        });
      } catch (error) {
        log.warn("could not load task state — flagging as unknown", {
          taskId: hoglet.taskId,
          error: stringifyError(error),
        });
        enriched.push({
          hoglet,
          taskRunStatus: "unknown",
          latestRunId: null,
          branch: null,
        });
      }
    }
    return { nest, hoglets: enriched };
  }

  private loadScratchpad(nestId: string): ScratchpadEntry[] {
    const row = this.stateRepo.findByNestId(nestId);
    if (!row?.serializedStateJson) return [];
    try {
      const parsed = JSON.parse(row.serializedStateJson) as {
        scratchpad?: ScratchpadEntry[];
      };
      return Array.isArray(parsed.scratchpad) ? parsed.scratchpad : [];
    } catch (error) {
      log.warn("scratchpad json corrupt, ignoring", { nestId, error });
      return [];
    }
  }

  private summariseLlmResponse(
    reason: string,
    response: PromptWithToolsOutput,
  ): ScratchpadEntry[] {
    return [
      {
        ts: new Date().toISOString(),
        kind: "observation",
        summary: `Tick ran (reason=${reason}, model=${response.model}, stop=${response.stopReason ?? "?"}, tools=${response.toolUseBlocks.length}, in=${response.usage.inputTokens}, out=${response.usage.outputTokens}).`,
      },
    ];
  }

  private writeNestMessage(
    nestId: string,
    input: {
      kind: "hedgehog_message" | "audit" | "tool_result";
      body: string;
      visibility?: "summary" | "detail";
      sourceTaskId?: string | null;
      payloadJson?: Record<string, unknown> | null;
    },
  ): void {
    const message = this.nestChat.recordHedgehogMessage({
      nestId,
      kind: input.kind,
      body: input.body,
      visibility: input.visibility ?? "summary",
      sourceTaskId: input.sourceTaskId ?? null,
      payloadJson: input.payloadJson ?? null,
    });
    this.nestService.emitMessageAppended(message);
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
