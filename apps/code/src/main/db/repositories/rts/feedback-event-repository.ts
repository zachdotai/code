import { and, desc, eq } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../../di/tokens";
import { rtsFeedbackEvents } from "../../schema";
import type { DatabaseService } from "../../service";

export type FeedbackEvent = typeof rtsFeedbackEvents.$inferSelect;
export type NewFeedbackEvent = typeof rtsFeedbackEvents.$inferInsert;

export type FeedbackEventSource = "pr_review" | "ci" | "issue" | "hedgehog";
export type FeedbackEventOutcome =
  | "pending"
  | "injected"
  | "follow_up_spawned"
  | "failed";
export type FeedbackTrustTier = "operator" | "internal" | "external";
export type FeedbackProcessingState = "active" | "queued" | "unknown";

export interface InsertFeedbackEventData {
  nestId: string | null;
  hogletTaskId: string;
  source: FeedbackEventSource;
  payloadHash: string;
  payloadRef: string;
  trustTier?: FeedbackTrustTier;
  routedOutcome: FeedbackEventOutcome;
  processed?: FeedbackProcessingState;
}

export interface DedupeKey {
  hogletTaskId: string;
  source: FeedbackEventSource;
  payloadHash: string;
}

const byDedupeKey = (key: DedupeKey) =>
  and(
    eq(rtsFeedbackEvents.hogletTaskId, key.hogletTaskId),
    eq(rtsFeedbackEvents.source, key.source),
    eq(rtsFeedbackEvents.payloadHash, key.payloadHash),
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
      this.db.select().from(rtsFeedbackEvents).where(byDedupeKey(key)).get() ??
      null
    );
  }

  /**
   * Finalises the outcome for a previously-reserved pending row. If no row
   * exists for the dedupe key (e.g. caller skipped `tryReservePending`),
   * inserts a fresh row with the supplied outcome.
   */
  setOutcome(data: InsertFeedbackEventData): {
    inserted: boolean;
    row: FeedbackEvent;
  } {
    const existing = this.findByDedupeKey({
      hogletTaskId: data.hogletTaskId,
      source: data.source,
      payloadHash: data.payloadHash,
    });
    if (existing) {
      this.db
        .update(rtsFeedbackEvents)
        .set({
          routedOutcome: data.routedOutcome,
          nestId: data.nestId,
          payloadRef: data.payloadRef,
          trustTier: data.trustTier ?? existing.trustTier,
          processed: data.processed ?? existing.processed ?? "unknown",
        })
        .where(byDedupeKey(data))
        .run();
      const updated = this.findByDedupeKey({
        hogletTaskId: data.hogletTaskId,
        source: data.source,
        payloadHash: data.payloadHash,
      });
      if (!updated) {
        throw new Error(
          `Feedback event vanished after update for ${data.payloadRef}`,
        );
      }
      return { inserted: false, row: updated };
    }
    return this.insertIgnoreOnDuplicate(data);
  }

  /**
   * Atomic reservation: inserts a `pending` row keyed on (hogletTaskId,
   * source, payloadHash). Returns `reserved: true` on the first call,
   * `reserved: false` if a row already existed (caller should skip emit).
   * The pending row makes the dedup check race-free even between the
   * router emitting an event and the renderer recording the final outcome.
   */
  tryReservePending(data: Omit<InsertFeedbackEventData, "routedOutcome">): {
    reserved: boolean;
    row: FeedbackEvent;
  } {
    const { inserted, row } = this.insertIgnoreOnDuplicate({
      ...data,
      routedOutcome: "pending",
    });
    return { reserved: inserted, row };
  }

  insertIgnoreOnDuplicate(data: InsertFeedbackEventData): {
    inserted: boolean;
    row: FeedbackEvent;
  } {
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
      processed: data.processed ?? "unknown",
      injectedAt,
    };
    const returned = this.db
      .insert(rtsFeedbackEvents)
      .values(row)
      .onConflictDoNothing({
        target: [
          rtsFeedbackEvents.hogletTaskId,
          rtsFeedbackEvents.source,
          rtsFeedbackEvents.payloadHash,
        ],
      })
      .returning()
      .all();
    if (returned.length > 0) {
      return { inserted: true, row: returned[0] };
    }
    const existing = this.findByDedupeKey({
      hogletTaskId: data.hogletTaskId,
      source: data.source,
      payloadHash: data.payloadHash,
    });
    if (!existing) {
      throw new Error(
        `Insert conflict but no existing row for feedback event ${id}`,
      );
    }
    return { inserted: false, row: existing };
  }

  listForNest(nestId: string, limit: number): FeedbackEvent[] {
    return this.db
      .select()
      .from(rtsFeedbackEvents)
      .where(eq(rtsFeedbackEvents.nestId, nestId))
      .orderBy(desc(rtsFeedbackEvents.injectedAt))
      .limit(limit)
      .all();
  }
}
