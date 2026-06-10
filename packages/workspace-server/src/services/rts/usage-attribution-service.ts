import { inject, injectable, postConstruct } from "inversify";
import {
  HOGLET_REPOSITORY,
  NEST_REPOSITORY,
  USAGE_EVENT_REPOSITORY,
} from "../../db/identifiers";
import type { HogletRepository } from "../../db/repositories/rts/hoglet-repository";
import type { NestRepository } from "../../db/repositories/rts/nest-repository";
import type {
  CostSource,
  UsageEventRepository,
  UsageWorkload,
} from "../../db/repositories/rts/usage-event-repository";
import type { AgentService } from "../agent/agent";
import { AGENT_SERVICE } from "../agent/identifiers";
import { AgentServiceEvent } from "../agent/schemas";
import { RTS_AUTH } from "./identifiers";
import { logger } from "./logger";
import type { RtsAuth } from "./ports";
import {
  computeCostUsd,
  hasPricingFor,
  type TokenCounts,
} from "./usage-pricing";

const log = logger.scope("usage-attribution");

export interface HogletTurnUsage {
  taskId: string;
  taskRunId: string | null;
  turnIndex: number | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** SDK-reported total_cost_usd for this turn, if present. */
  sdkCostUsd?: number | null;
}

export interface HedgehogTickUsage {
  nestId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

interface RecordedUsage {
  inserted: boolean;
  costUsd: number;
  costSource: CostSource;
}

@injectable()
export class UsageAttributionService {
  constructor(
    @inject(USAGE_EVENT_REPOSITORY)
    private readonly usageEventRepo: UsageEventRepository,
    @inject(HOGLET_REPOSITORY)
    private readonly hogletRepo: HogletRepository,
    @inject(NEST_REPOSITORY)
    private readonly nestRepo: NestRepository,
    @inject(RTS_AUTH)
    private readonly authService: RtsAuth,
    @inject(AGENT_SERVICE)
    private readonly agentService: AgentService,
  ) {}

  @postConstruct()
  init(): void {
    this.agentService.on(AgentServiceEvent.UsageUpdate, (payload) => {
      try {
        this.recordHogletTurn({
          taskId: payload.taskId,
          taskRunId: payload.taskRunId,
          turnIndex: payload.turnIndex,
          model: payload.model,
          inputTokens: payload.inputTokens,
          outputTokens: payload.outputTokens,
          cacheReadTokens: payload.cacheReadTokens,
          cacheCreationTokens: payload.cacheCreationTokens,
          sdkCostUsd: payload.costUsd,
        });
      } catch (error) {
        log.warn("Failed to record hoglet usage", {
          taskRunId: payload.taskRunId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * Record one turn of hoglet (cloud TaskRun) work. Called from the agent
   * service when a `_posthog/usage_update` notification arrives.
   *
   * Idempotent on `(taskRunId, turnIndex)` — repeated calls with the same
   * pair are no-ops (and won't double-count rolling totals).
   */
  recordHogletTurn(input: HogletTurnUsage): RecordedUsage | null {
    const hoglet = this.hogletRepo.findByTaskId(input.taskId);
    if (!hoglet) {
      log.debug("recordHogletTurn: no rts hoglet for taskId, skipping", {
        taskId: input.taskId,
      });
      return null;
    }

    const workload: UsageWorkload =
      hoglet.nestId == null ? "wild-hoglet" : "brood-hoglet";
    const usage: TokenCounts = {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cacheReadTokens: input.cacheReadTokens,
      cacheCreationTokens: input.cacheCreationTokens,
    };

    const { costUsd, costSource } = this.resolveCost(
      input.sdkCostUsd,
      usage,
      input.model,
    );
    const environment = this.resolveEnvironment();

    const { inserted } = this.usageEventRepo.insertIgnoreOnDuplicate({
      nestId: hoglet.nestId,
      hogletId: hoglet.id,
      taskId: input.taskId,
      taskRunId: input.taskRunId,
      turnIndex: input.turnIndex,
      environment,
      workload,
      model: input.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      costUsd,
      costSource,
    });

    if (inserted) {
      const occurredAt = new Date().toISOString();
      this.hogletRepo.incrementUsage(hoglet.id, {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        costUsd,
        occurredAt,
      });
      if (hoglet.nestId) {
        this.nestRepo.incrementUsage(hoglet.nestId, {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          costUsd,
          occurredAt,
        });
      }
    }

    return { inserted, costUsd, costSource };
  }

  /**
   * Record one hedgehog tick (LlmGateway promptWithTools result). LlmGateway
   * does not expose cache-read / cache-creation counts or USD cost, so this
   * always uses the pricing-table fallback. Cache columns default to 0.
   */
  recordHedgehogTick(input: HedgehogTickUsage): RecordedUsage {
    const usage: TokenCounts = {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cacheReadTokens: input.cacheReadTokens ?? 0,
      cacheCreationTokens: input.cacheCreationTokens ?? 0,
    };
    const costUsd = computeCostUsd(usage, input.model);
    const environment = this.resolveEnvironment();

    const { inserted } = this.usageEventRepo.insertIgnoreOnDuplicate({
      nestId: input.nestId,
      hogletId: null,
      taskId: null,
      taskRunId: null,
      turnIndex: null,
      environment,
      workload: "hedgehog-tick",
      model: input.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      costUsd,
      costSource: "pricing_table",
    });

    if (inserted) {
      const occurredAt = new Date().toISOString();
      this.nestRepo.incrementUsage(input.nestId, {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        costUsd,
        occurredAt,
      });
    }

    return { inserted, costUsd, costSource: "pricing_table" };
  }

  private resolveCost(
    sdkCostUsd: number | null | undefined,
    usage: TokenCounts,
    model: string,
  ): { costUsd: number; costSource: CostSource } {
    if (typeof sdkCostUsd === "number" && sdkCostUsd >= 0) {
      return { costUsd: sdkCostUsd, costSource: "sdk" };
    }
    if (hasPricingFor(model)) {
      return {
        costUsd: computeCostUsd(usage, model),
        costSource: "pricing_table",
      };
    }
    log.warn("No SDK cost and no pricing entry; recording cost=0", { model });
    return { costUsd: 0, costSource: "pricing_table" };
  }

  private resolveEnvironment(): string {
    const region = this.authService.getState().cloudRegion;
    if (region === "us") return "prod-us";
    if (region === "eu") return "prod-eu";
    return "dev";
  }
}
