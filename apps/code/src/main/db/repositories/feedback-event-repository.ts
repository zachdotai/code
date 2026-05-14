import { and, desc, eq } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { hedgemonyFeedbackEvents } from "../schema";
import type { DatabaseService } from "../service";

export type FeedbackEvent = typeof hedgemonyFeedbackEvents.$inferSelect;
export type NewFeedbackEvent = typeof hedgemonyFeedbackEvents.$inferInsert;

export type FeedbackEventSource = "pr_review" | "ci" | "issue";
export type FeedbackEventOutcome = "injected" | "follow_up_spawned" | "failed";
export type FeedbackTrustTier = "operator" | "internal" | "external";

export interface InsertFeedbackEventData {
  nestId: string | null;
  hogletTaskId: string;
  source: FeedbackEventSource;
  payloadHash: string;
  payloadRef: string;
  trustTier?: FeedbackTrustTier;
  routedOutcome: FeedbackEventOutcome;
}

export interface DedupeKey {
  hogletTaskId: string;
  source: FeedbackEventSource;
  payloadHash: string;
}

const byDedupeKey = (key: DedupeKey) =>
  and(
    eq(hedgemonyFeedbackEvents.hogletTaskId, key.hogletTaskId),
    eq(hedgemonyFeedbackEvents.source, key.source),
    eq(hedgemonyFeedbackEvents.payloadHash, key.payloadHash),
  );

@injectable()
export class FeedbackEventRepository {
  constructor(
    @inject(MAIN_TOKENS.DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  findByDedupeKey(key: DedupeKey): FeedbackEvent | null {
    return (
      this.db
        .select()
        .from(hedgemonyFeedbackEvents)
        .where(byDedupeKey(key))
        .get() ?? null
    );
  }

  insertIgnoreOnDuplicate(data: InsertFeedbackEventData): {
    inserted: boolean;
    row: FeedbackEvent;
  } {
    const existing = this.findByDedupeKey({
      hogletTaskId: data.hogletTaskId,
      source: data.source,
      payloadHash: data.payloadHash,
    });
    if (existing) {
      return { inserted: false, row: existing };
    }
    const id = crypto.randomUUID();
    const injectedAt = new Date().toISOString();
    const row: NewFeedbackEvent = {
      id,
      nestId: data.nestId,
      hogletTaskId: data.hogletTaskId,
      source: data.source,
      payloadHash: data.payloadHash,
      payloadRef: data.payloadRef,
      trustTier: data.trustTier ?? "external",
      routedOutcome: data.routedOutcome,
      injectedAt,
    };
    this.db.insert(hedgemonyFeedbackEvents).values(row).run();
    const created = this.findByDedupeKey({
      hogletTaskId: data.hogletTaskId,
      source: data.source,
      payloadHash: data.payloadHash,
    });
    if (!created) {
      throw new Error(`Failed to insert feedback event ${id}`);
    }
    return { inserted: true, row: created };
  }

  listForNest(nestId: string, limit: number): FeedbackEvent[] {
    return this.db
      .select()
      .from(hedgemonyFeedbackEvents)
      .where(eq(hedgemonyFeedbackEvents.nestId, nestId))
      .orderBy(desc(hedgemonyFeedbackEvents.injectedAt))
      .limit(limit)
      .all();
  }
}
