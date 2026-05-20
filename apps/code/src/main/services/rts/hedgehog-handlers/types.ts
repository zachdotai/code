import type { OperatorDecision } from "../../../db/repositories/operator-decision-repository";
import type { PrDependency } from "../../../db/repositories/pr-dependency-repository";
import type { AnthropicToolUseBlock } from "../../llm-gateway/schemas";
import type { CloudTaskClient } from "../cloud-task-client";
import type { FeedbackRoutingService } from "../feedback-routing-service";
import type {
  HogletWithState,
  NestAnomalies,
  NestRepositoryContext,
} from "../hedgehog-prompts";
import type { HedgehogToolName, HoldArgs } from "../hedgehog-tools";
import type { HogletService } from "../hoglet-service";
import type { NestService } from "../nest-service";
import type { PrGraphService } from "../pr-graph-service";
import type { Nest, NestLoadout } from "../schemas";

/**
 * Per-tick state shared across handler invocations. Handlers that need to
 * enforce per-tick budgets (e.g. raise_hoglet's cap) read and mutate this
 * directly; the dispatcher constructs a fresh instance for each tick.
 */
export class TickBudget {
  raiseCount = 0;
  spawnCount = 0;
}

export interface TickContext {
  readonly nest: Nest;
  readonly hoglets: HogletWithState[];
  readonly budget: TickBudget;
  readonly prDependencies: PrDependency[];
  readonly loadout: NestLoadout;
  readonly nestAnomalies?: NestAnomalies;
  readonly repositoryContext: NestRepositoryContext;
  /**
   * Operator-override memory — decisions the operator explicitly made that
   * gate future ticks (e.g. revived hoglets the hedgehog must not kill again,
   * suppressed signal reports she must not respawn). The dispatcher
   * cross-checks each spawn/kill tool call against this list to prevent
   * whack-a-mole loops where the hedgehog keeps undoing the operator.
   */
  readonly operatorDecisions: OperatorDecision[];
}

export interface WriteNestMessageInput {
  kind: "hedgehog_message" | "audit" | "tool_result";
  body: string;
  visibility?: "summary" | "detail";
  sourceTaskId?: string | null;
  payloadJson?: Record<string, unknown> | null;
}

export interface HedgehogToolDeps {
  readonly cloudTasks: CloudTaskClient;
  readonly prGraph: PrGraphService;
  readonly feedbackRouting: FeedbackRoutingService;
  readonly hogletService: HogletService;
  readonly nestService: NestService;
  writeNestMessage(nestId: string, input: WriteNestMessageInput): void;
}

export interface HandlerResult {
  readonly success: boolean;
  readonly scratchpadSummary: string;
  readonly stopDispatch?: boolean;
  readonly hold?: HoldArgs;
}

export interface HedgehogToolHandler {
  readonly name: HedgehogToolName;
  handle(
    ctx: TickContext,
    block: AnthropicToolUseBlock,
    deps: HedgehogToolDeps,
  ): Promise<HandlerResult>;
}
