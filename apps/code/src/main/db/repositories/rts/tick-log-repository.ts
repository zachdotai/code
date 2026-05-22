import { and, count, eq, gt } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../../di/tokens";
import { rtsTickLog } from "../../schema";
import type { DatabaseService } from "../../service";

export type TickLog = typeof rtsTickLog.$inferSelect;
export type NewTickLog = typeof rtsTickLog.$inferInsert;

export type TickOutcome = "completed" | "errored" | "aborted" | "capped";

export interface InsertTickLogData {
  nestId: string;
  outcome: TickOutcome;
  tickedAt?: string;
}

@injectable()
export class TickLogRepository {
  constructor(
    @inject(MAIN_TOKENS.DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  insert(data: InsertTickLogData): TickLog {
    const id = crypto.randomUUID();
    const tickedAt = data.tickedAt ?? new Date().toISOString();
    const row: TickLog = {
      id,
      nestId: data.nestId,
      tickedAt,
      outcome: data.outcome,
    };
    this.db.insert(rtsTickLog).values(row).run();
    return row;
  }

  /**
   * Counts tick log rows for `nestId` whose `tickedAt` is strictly after
   * `sinceIso`. Used by the hedgehog tick service to enforce the per-nest,
   * per-hour cap.
   */
  countSince(nestId: string, sinceIso: string): number {
    const result = this.db
      .select({ value: count() })
      .from(rtsTickLog)
      .where(
        and(
          eq(rtsTickLog.nestId, nestId),
          gt(rtsTickLog.tickedAt, sinceIso),
        ),
      )
      .get();
    return result?.value ?? 0;
  }
}
