import { inject, injectable } from "inversify";
import type { CloudTaskClient } from "./cloud-task-client";
import type { FeedbackRoutingService } from "./feedback-routing-service";
import { HEDGEHOG_HANDLERS } from "./hedgehog-handlers/registry";
import type {
  HandlerResult,
  HedgehogToolDeps,
  TickContext,
  WriteNestMessageInput,
} from "./hedgehog-handlers/types";
import type { HogletWithState, ScratchpadEntry } from "./hedgehog-prompts";
import {
  latestHogletOutputAt,
  latestOperatorMessageAt,
  prStatusFingerprint,
} from "./hedgehog-tick-helpers";
import type { HogletService } from "./hoglet-service";
import {
  CLOUD_TASK_CLIENT,
  FEEDBACK_ROUTING_SERVICE,
  HOGLET_SERVICE,
  NEST_CHAT_SERVICE,
  NEST_SERVICE,
  PR_GRAPH_SERVICE,
} from "./identifiers";
import type { PromptWithToolsOutput } from "./llm-gateway";
import { logger } from "./logger";
import type { NestChatService } from "./nest-chat-service";
import type { NestService } from "./nest-service";
import type { PrGraphService } from "./pr-graph-service";
import type { ActiveHoldState, NestMessage } from "./schemas";

const log = logger.scope("hedgehog-decision-router");

// Safety net only: event holds should usually release via run/PR fingerprints
// first. Kept in sync with `HedgehogTickService`.
const EVENT_HOLD_FALLBACK_TIMEOUT_SECONDS = 10 * 60;

export interface DispatchInput {
  readonly tickContext: TickContext;
  readonly recentChat: NestMessage[];
  readonly response: PromptWithToolsOutput;
  readonly reason: string;
  readonly abortSignal?: AbortSignal;
}

export interface DispatchOutput {
  readonly aborted: boolean;
  readonly scratchpadEntries: ScratchpadEntry[];
  readonly nextActiveHold: ActiveHoldState | null;
}

/**
 * Owns handler dispatch and feedback correlation for the hedgehog. Split off
 * from `HedgehogTickService` so the tick service stays focused on scheduling,
 * perception and persistence.
 *
 * Responsibilities:
 *  - Build the per-tick handler dep bag (`HedgehogToolDeps`).
 *  - Route each `tool_use` block from the LLM to the matching handler from
 *    `HEDGEHOG_HANDLERS`, in order, respecting `stopDispatch` and `hold` results.
 *  - Translate handler `hold` results into a serialisable `ActiveHoldState`
 *    (suspending future ticks until the right signal arrives).
 *  - Emit hoglet "changed" notifications when a task run reaches a terminal
 *    state — the feedback-correlation seam that lets the next tick treat fresh
 *    outcomes as new input.
 *  - Provide the shared `writeNestMessage` helper used by both handlers (via
 *    `HedgehogToolDeps.writeNestMessage`) and the tick service itself.
 */
@injectable()
export class HedgehogDecisionRouter {
  constructor(
    @inject(NEST_SERVICE)
    private readonly nestService: NestService,
    @inject(HOGLET_SERVICE)
    private readonly hogletService: HogletService,
    @inject(NEST_CHAT_SERVICE)
    private readonly nestChat: NestChatService,
    @inject(CLOUD_TASK_CLIENT)
    private readonly cloudTasks: CloudTaskClient,
    @inject(PR_GRAPH_SERVICE)
    private readonly prGraph: PrGraphService,
    @inject(FEEDBACK_ROUTING_SERVICE)
    private readonly feedbackRouting: FeedbackRoutingService,
  ) {}

  /**
   * Run the handler dispatch loop over an LLM response. Returns the scratchpad
   * entries to merge into persisted state, the next active hold (if any
   * handler asked for one), and a flag telling the caller whether the loop was
   * cut short by an abort signal.
   */
  async dispatch(input: DispatchInput): Promise<DispatchOutput> {
    const { tickContext, recentChat, response, reason, abortSignal } = input;
    const deps = this.buildHandlerDeps();
    const scratchpadEntries: ScratchpadEntry[] = [
      ...this.summariseLlmResponse(reason, response),
    ];
    let nextActiveHold: ActiveHoldState | null = null;
    let suppressFreeTextMessage = false;

    if (response.stopReason === "max_tokens") {
      const toolCount = response.toolUseBlocks.length;
      const body =
        toolCount > 0
          ? `Hedgehog response hit the max token limit, so ${toolCount} tool call${toolCount === 1 ? "" : "s"} were discarded instead of executing a partial batch.`
          : "Hedgehog response hit the max token limit before producing an action.";
      this.writeNestMessage(tickContext.nest.id, {
        kind: "audit",
        body,
        visibility: "summary",
        payloadJson: {
          type: "hedgehog_response_truncated",
          tickReason: reason,
          stopReason: response.stopReason,
          toolUseBlocks: toolCount,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        },
      });
      scratchpadEntries.push({
        ts: new Date().toISOString(),
        kind: "decision",
        summary:
          toolCount > 0
            ? `Discarded ${toolCount} tool call${toolCount === 1 ? "" : "s"} from a max_tokens response; retry with one concise action or a smaller set of hoglets.`
            : "The hedgehog response hit max_tokens before an action; retry with one concise action.",
      });
      return { aborted: false, scratchpadEntries, nextActiveHold };
    }

    for (const block of response.toolUseBlocks) {
      if (abortSignal?.aborted) {
        return { aborted: true, scratchpadEntries, nextActiveHold };
      }
      const handler = HEDGEHOG_HANDLERS.get(
        block.name as Parameters<typeof HEDGEHOG_HANDLERS.get>[0],
      );
      if (!handler) {
        log.warn("unknown tool name from hedgehog", { name: block.name });
        scratchpadEntries.push({
          ts: new Date().toISOString(),
          kind: "decision",
          summary: `Ignored unknown tool ${block.name}`,
        });
        continue;
      }
      const result = await handler.handle(tickContext, block, deps);
      scratchpadEntries.push({
        ts: new Date().toISOString(),
        kind: "decision",
        summary: result.scratchpadSummary,
      });
      if (result.hold) {
        nextActiveHold = this.buildActiveHoldState(
          result.hold,
          tickContext,
          recentChat,
        );
        suppressFreeTextMessage = true;
      }
      if (result.stopDispatch) break;
    }

    const combinedText = response.textBlocks
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join("\n");
    if (combinedText.length > 0) {
      if (suppressFreeTextMessage) {
        scratchpadEntries.push({
          ts: new Date().toISOString(),
          kind: "note",
          summary: `Hold reasoning: ${truncateForScratchpad(combinedText)}`,
        });
      } else {
        this.writeNestMessage(tickContext.nest.id, {
          kind: "hedgehog_message",
          body: combinedText,
          visibility: "summary",
          payloadJson: {
            tickReason: reason,
            stopReason: response.stopReason,
          },
        });
      }
    }

    return { aborted: false, scratchpadEntries, nextActiveHold };
  }

  /**
   * Feedback correlation: for any hoglet whose latest run has reached a
   * terminal state (completed / failed / cancelled) since the last tick,
   * emit a `hoglet_changed` event so downstream listeners — including the
   * tick scheduler itself — pick up the new outcome.
   *
   * Returns the next observed-run-key map for persistence.
   */
  emitNewTerminalHogletChanges(
    hoglets: HogletWithState[],
    previousObservedRunKeys: Record<string, string>,
  ): Record<string, string> {
    const nextObservedRunKeys: Record<string, string> = {};
    for (const entry of hoglets) {
      const runKey = terminalRunKey(entry);
      if (!runKey) continue;
      nextObservedRunKeys[entry.hoglet.taskId] = runKey;
      if (previousObservedRunKeys[entry.hoglet.taskId] !== runKey) {
        this.hogletService.emitChanged(entry.hoglet);
      }
    }
    return nextObservedRunKeys;
  }

  /**
   * Writes a message to the nest chat and emits the corresponding event.
   * Shared between handlers (via `HedgehogToolDeps`) and the tick service's
   * own audit / cap / error paths.
   */
  writeNestMessage(nestId: string, input: WriteNestMessageInput): void {
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

  private buildHandlerDeps(): HedgehogToolDeps {
    return {
      cloudTasks: this.cloudTasks,
      prGraph: this.prGraph,
      feedbackRouting: this.feedbackRouting,
      hogletService: this.hogletService,
      nestService: this.nestService,
      writeNestMessage: (nestId, input) => this.writeNestMessage(nestId, input),
    };
  }

  private buildActiveHoldState(
    hold: NonNullable<HandlerResult["hold"]>,
    ctx: TickContext,
    recentChat: NestMessage[],
  ): ActiveHoldState {
    const createdAt = new Date().toISOString();
    const timeoutSeconds =
      hold.timeoutSeconds ?? EVENT_HOLD_FALLBACK_TIMEOUT_SECONDS;
    return {
      reason: hold.reason,
      nextTrigger: hold.nextTrigger,
      timeoutSeconds,
      createdAt,
      timeoutAt: new Date(
        Date.parse(createdAt) + timeoutSeconds * 1000,
      ).toISOString(),
      lastOperatorMessageAt: latestOperatorMessageAt(recentChat),
      lastHogletOutputAt: latestHogletOutputAt(recentChat),
      prStatusFingerprint: prStatusFingerprint(ctx.hoglets, ctx.prDependencies),
    };
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
}

function isTerminalTaskRunStatus(
  status: HogletWithState["taskRunStatus"],
): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function terminalRunKey(entry: HogletWithState): string | null {
  if (!isTerminalTaskRunStatus(entry.taskRunStatus)) return null;
  return [
    entry.latestRunId ?? "missing-run-id",
    entry.taskRunStatus,
    entry.latestRunCompletedAt ?? "missing-completed-at",
  ].join(":");
}

function truncateForScratchpad(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  // Leave room for the "Hold reasoning: " prefix under the 1000-char
  // scratchpad schema limit.
  if (singleLine.length <= 900) return singleLine;
  return `${singleLine.slice(0, 900)}... (truncated)`;
}
