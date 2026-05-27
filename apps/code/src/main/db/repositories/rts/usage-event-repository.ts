import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../../di/tokens";
import { rtsUsageEvents } from "../../schema";
import type { DatabaseService } from "../../service";

export type UsageEvent = typeof rtsUsageEvents.$inferSelect;
export type NewUsageEvent = typeof rtsUsageEvents.$inferInsert;

export type UsageWorkload = "hedgehog-tick" | "brood-hoglet" | "wild-hoglet";
export type CostSource = "sdk" | "pricing_table";

export interface InsertUsageEventData {
  nestId: string | null;
  hogletId: string | null;
  taskId: string | null;
  taskRunId: string | null;
  turnIndex: number | null;
  environment: string;
  workload: UsageWorkload;
  purpose?: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  costSource: CostSource;
}

export interface AggregateRow {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsd: number;
  eventCount: number;
}

const emptyAggregate: AggregateRow = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheReadTokens: 0,
  totalCacheCreationTokens: 0,
  totalCostUsd: 0,
  eventCount: 0,
};

@injectable()
export class UsageEventRepository {
  constructor(
    @inject(MAIN_TOKENS.DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  insertIgnoreOnDuplicate(data: InsertUsageEventData): {
    inserted: boolean;
    row: UsageEvent;
  } {
    const id = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const row: NewUsageEvent = {
      id,
      nestId: data.nestId,
      hogletId: data.hogletId,
      taskId: data.taskId,
      taskRunId: data.taskRunId,
      turnIndex: data.turnIndex,
      environment: data.environment,
      workload: data.workload,
      purpose: data.purpose ?? null,
      model: data.model,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cacheReadTokens: data.cacheReadTokens,
      cacheCreationTokens: data.cacheCreationTokens,
      costUsd: data.costUsd,
      costSource: data.costSource,
      occurredAt,
    };
    const returned = this.db
      .insert(rtsUsageEvents)
      .values(row)
      .onConflictDoNothing({
        target: [rtsUsageEvents.taskRunId, rtsUsageEvents.turnIndex],
      })
      .returning()
      .all();
    if (returned.length > 0) {
      return { inserted: true, row: returned[0] };
    }
    // Dedupe collision (taskRunId+turnIndex already existed). Surface the
    // existing row so the caller can decide whether to skip rollup updates.
    if (data.taskRunId != null && data.turnIndex != null) {
      const existing = this.db
        .select()
        .from(rtsUsageEvents)
        .where(
          and(
            eq(rtsUsageEvents.taskRunId, data.taskRunId),
            eq(rtsUsageEvents.turnIndex, data.turnIndex),
          ),
        )
        .get();
      if (existing) {
        return { inserted: false, row: existing };
      }
    }
    throw new Error(
      `Insert conflict but no existing row for usage event ${id}`,
    );
  }

  listByNest(nestId: string, limit = 1000): UsageEvent[] {
    return this.db
      .select()
      .from(rtsUsageEvents)
      .where(eq(rtsUsageEvents.nestId, nestId))
      .orderBy(desc(rtsUsageEvents.occurredAt))
      .limit(limit)
      .all();
  }

  listByHoglet(hogletId: string, limit = 1000): UsageEvent[] {
    return this.db
      .select()
      .from(rtsUsageEvents)
      .where(eq(rtsUsageEvents.hogletId, hogletId))
      .orderBy(desc(rtsUsageEvents.occurredAt))
      .limit(limit)
      .all();
  }

  aggregateByNest(nestId: string, since?: string): AggregateRow {
    const row = this.db
      .select({
        totalInputTokens: sql<number>`coalesce(sum(${rtsUsageEvents.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${rtsUsageEvents.outputTokens}), 0)`,
        totalCacheReadTokens: sql<number>`coalesce(sum(${rtsUsageEvents.cacheReadTokens}), 0)`,
        totalCacheCreationTokens: sql<number>`coalesce(sum(${rtsUsageEvents.cacheCreationTokens}), 0)`,
        totalCostUsd: sql<number>`coalesce(sum(${rtsUsageEvents.costUsd}), 0)`,
        eventCount: sql<number>`count(*)`,
      })
      .from(rtsUsageEvents)
      .where(
        since
          ? and(
              eq(rtsUsageEvents.nestId, nestId),
              gte(rtsUsageEvents.occurredAt, since),
            )
          : eq(rtsUsageEvents.nestId, nestId),
      )
      .get();
    return row ?? emptyAggregate;
  }

  aggregateByHoglet(hogletId: string, since?: string): AggregateRow {
    const row = this.db
      .select({
        totalInputTokens: sql<number>`coalesce(sum(${rtsUsageEvents.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${rtsUsageEvents.outputTokens}), 0)`,
        totalCacheReadTokens: sql<number>`coalesce(sum(${rtsUsageEvents.cacheReadTokens}), 0)`,
        totalCacheCreationTokens: sql<number>`coalesce(sum(${rtsUsageEvents.cacheCreationTokens}), 0)`,
        totalCostUsd: sql<number>`coalesce(sum(${rtsUsageEvents.costUsd}), 0)`,
        eventCount: sql<number>`count(*)`,
      })
      .from(rtsUsageEvents)
      .where(
        since
          ? and(
              eq(rtsUsageEvents.hogletId, hogletId),
              gte(rtsUsageEvents.occurredAt, since),
            )
          : eq(rtsUsageEvents.hogletId, hogletId),
      )
      .get();
    return row ?? emptyAggregate;
  }

  aggregateGlobal(since?: string): AggregateRow {
    const row = this.db
      .select({
        totalInputTokens: sql<number>`coalesce(sum(${rtsUsageEvents.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${rtsUsageEvents.outputTokens}), 0)`,
        totalCacheReadTokens: sql<number>`coalesce(sum(${rtsUsageEvents.cacheReadTokens}), 0)`,
        totalCacheCreationTokens: sql<number>`coalesce(sum(${rtsUsageEvents.cacheCreationTokens}), 0)`,
        totalCostUsd: sql<number>`coalesce(sum(${rtsUsageEvents.costUsd}), 0)`,
        eventCount: sql<number>`count(*)`,
      })
      .from(rtsUsageEvents)
      .where(since ? gte(rtsUsageEvents.occurredAt, since) : undefined)
      .get();
    return row ?? emptyAggregate;
  }

  aggregateByWorkload(
    since?: string,
  ): Array<{ workload: UsageWorkload; row: AggregateRow }> {
    const rows = this.db
      .select({
        workload: rtsUsageEvents.workload,
        totalInputTokens: sql<number>`coalesce(sum(${rtsUsageEvents.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${rtsUsageEvents.outputTokens}), 0)`,
        totalCacheReadTokens: sql<number>`coalesce(sum(${rtsUsageEvents.cacheReadTokens}), 0)`,
        totalCacheCreationTokens: sql<number>`coalesce(sum(${rtsUsageEvents.cacheCreationTokens}), 0)`,
        totalCostUsd: sql<number>`coalesce(sum(${rtsUsageEvents.costUsd}), 0)`,
        eventCount: sql<number>`count(*)`,
      })
      .from(rtsUsageEvents)
      .where(since ? gte(rtsUsageEvents.occurredAt, since) : undefined)
      .groupBy(rtsUsageEvents.workload)
      .all();
    return rows.map(({ workload, ...row }) => ({
      workload: workload as UsageWorkload,
      row,
    }));
  }

  aggregateByModel(
    since?: string,
  ): Array<{ model: string; row: AggregateRow }> {
    const rows = this.db
      .select({
        model: rtsUsageEvents.model,
        totalInputTokens: sql<number>`coalesce(sum(${rtsUsageEvents.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${rtsUsageEvents.outputTokens}), 0)`,
        totalCacheReadTokens: sql<number>`coalesce(sum(${rtsUsageEvents.cacheReadTokens}), 0)`,
        totalCacheCreationTokens: sql<number>`coalesce(sum(${rtsUsageEvents.cacheCreationTokens}), 0)`,
        totalCostUsd: sql<number>`coalesce(sum(${rtsUsageEvents.costUsd}), 0)`,
        eventCount: sql<number>`count(*)`,
      })
      .from(rtsUsageEvents)
      .where(since ? gte(rtsUsageEvents.occurredAt, since) : undefined)
      .groupBy(rtsUsageEvents.model)
      .orderBy(desc(sql`sum(${rtsUsageEvents.costUsd})`))
      .all();
    return rows.map(({ model, ...row }) => ({ model, row }));
  }

  /**
   * Top nests by total cost. Events with a null `nestId` (e.g. wild hoglet
   * turns recorded before adoption) are excluded — the rollup is for nest
   * attribution only.
   */
  topNestsByCost(
    limit = 5,
    since?: string,
  ): Array<{ nestId: string; row: AggregateRow }> {
    const rows = this.db
      .select({
        nestId: rtsUsageEvents.nestId,
        totalInputTokens: sql<number>`coalesce(sum(${rtsUsageEvents.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${rtsUsageEvents.outputTokens}), 0)`,
        totalCacheReadTokens: sql<number>`coalesce(sum(${rtsUsageEvents.cacheReadTokens}), 0)`,
        totalCacheCreationTokens: sql<number>`coalesce(sum(${rtsUsageEvents.cacheCreationTokens}), 0)`,
        totalCostUsd: sql<number>`coalesce(sum(${rtsUsageEvents.costUsd}), 0)`,
        eventCount: sql<number>`count(*)`,
      })
      .from(rtsUsageEvents)
      .where(
        since
          ? and(
              isNotNull(rtsUsageEvents.nestId),
              gte(rtsUsageEvents.occurredAt, since),
            )
          : isNotNull(rtsUsageEvents.nestId),
      )
      .groupBy(rtsUsageEvents.nestId)
      .orderBy(desc(sql`sum(${rtsUsageEvents.costUsd})`))
      .limit(limit)
      .all();
    return rows
      .filter((r): r is typeof r & { nestId: string } => r.nestId !== null)
      .map(({ nestId, ...row }) => ({ nestId, row }));
  }
}
