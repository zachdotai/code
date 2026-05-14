import { and, desc, eq, gte, sql } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { hedgemonyUsageEvents } from "../schema";
import type { DatabaseService } from "../service";

export type UsageEvent = typeof hedgemonyUsageEvents.$inferSelect;
export type NewUsageEvent = typeof hedgemonyUsageEvents.$inferInsert;

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
      .insert(hedgemonyUsageEvents)
      .values(row)
      .onConflictDoNothing({
        target: [
          hedgemonyUsageEvents.taskRunId,
          hedgemonyUsageEvents.turnIndex,
        ],
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
        .from(hedgemonyUsageEvents)
        .where(
          and(
            eq(hedgemonyUsageEvents.taskRunId, data.taskRunId),
            eq(hedgemonyUsageEvents.turnIndex, data.turnIndex),
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
      .from(hedgemonyUsageEvents)
      .where(eq(hedgemonyUsageEvents.nestId, nestId))
      .orderBy(desc(hedgemonyUsageEvents.occurredAt))
      .limit(limit)
      .all();
  }

  listByHoglet(hogletId: string, limit = 1000): UsageEvent[] {
    return this.db
      .select()
      .from(hedgemonyUsageEvents)
      .where(eq(hedgemonyUsageEvents.hogletId, hogletId))
      .orderBy(desc(hedgemonyUsageEvents.occurredAt))
      .limit(limit)
      .all();
  }

  aggregateByNest(nestId: string, since?: string): AggregateRow {
    const row = this.db
      .select({
        totalInputTokens: sql<number>`coalesce(sum(${hedgemonyUsageEvents.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${hedgemonyUsageEvents.outputTokens}), 0)`,
        totalCacheReadTokens: sql<number>`coalesce(sum(${hedgemonyUsageEvents.cacheReadTokens}), 0)`,
        totalCacheCreationTokens: sql<number>`coalesce(sum(${hedgemonyUsageEvents.cacheCreationTokens}), 0)`,
        totalCostUsd: sql<number>`coalesce(sum(${hedgemonyUsageEvents.costUsd}), 0)`,
        eventCount: sql<number>`count(*)`,
      })
      .from(hedgemonyUsageEvents)
      .where(
        since
          ? and(
              eq(hedgemonyUsageEvents.nestId, nestId),
              gte(hedgemonyUsageEvents.occurredAt, since),
            )
          : eq(hedgemonyUsageEvents.nestId, nestId),
      )
      .get();
    return row ?? emptyAggregate;
  }

  aggregateByHoglet(hogletId: string, since?: string): AggregateRow {
    const row = this.db
      .select({
        totalInputTokens: sql<number>`coalesce(sum(${hedgemonyUsageEvents.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${hedgemonyUsageEvents.outputTokens}), 0)`,
        totalCacheReadTokens: sql<number>`coalesce(sum(${hedgemonyUsageEvents.cacheReadTokens}), 0)`,
        totalCacheCreationTokens: sql<number>`coalesce(sum(${hedgemonyUsageEvents.cacheCreationTokens}), 0)`,
        totalCostUsd: sql<number>`coalesce(sum(${hedgemonyUsageEvents.costUsd}), 0)`,
        eventCount: sql<number>`count(*)`,
      })
      .from(hedgemonyUsageEvents)
      .where(
        since
          ? and(
              eq(hedgemonyUsageEvents.hogletId, hogletId),
              gte(hedgemonyUsageEvents.occurredAt, since),
            )
          : eq(hedgemonyUsageEvents.hogletId, hogletId),
      )
      .get();
    return row ?? emptyAggregate;
  }
}
