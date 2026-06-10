import type {
  DedupeKey,
  FeedbackEvent,
  InsertFeedbackEventData,
} from "./feedback-event-repository";

export interface MockFeedbackEventRepository {
  _events: FeedbackEvent[];
  findByDedupeKey(key: DedupeKey): FeedbackEvent | null;
  insertIgnoreOnDuplicate(data: InsertFeedbackEventData): {
    inserted: boolean;
    row: FeedbackEvent;
  };
  setOutcome(data: InsertFeedbackEventData): {
    inserted: boolean;
    row: FeedbackEvent;
  };
  tryReservePending(data: Omit<InsertFeedbackEventData, "routedOutcome">): {
    reserved: boolean;
    row: FeedbackEvent;
  };
  listForNest(nestId: string, limit: number): FeedbackEvent[];
}

export function createMockFeedbackEventRepository(): MockFeedbackEventRepository {
  const events: FeedbackEvent[] = [];

  const findByDedupeKey = (key: DedupeKey): FeedbackEvent | null => {
    const found = events.find(
      (e) =>
        e.hogletTaskId === key.hogletTaskId &&
        e.source === key.source &&
        e.payloadHash === key.payloadHash,
    );
    return found ? { ...found } : null;
  };

  const insertIgnoreOnDuplicate = (
    data: InsertFeedbackEventData,
  ): { inserted: boolean; row: FeedbackEvent } => {
    const existing = findByDedupeKey({
      hogletTaskId: data.hogletTaskId,
      source: data.source,
      payloadHash: data.payloadHash,
    });
    if (existing) {
      return { inserted: false, row: existing };
    }
    const row: FeedbackEvent = {
      id: crypto.randomUUID(),
      nestId: data.nestId,
      hogletTaskId: data.hogletTaskId,
      source: data.source,
      payloadHash: data.payloadHash,
      payloadRef: data.payloadRef,
      trustTier: data.trustTier ?? "external",
      routedOutcome: data.routedOutcome,
      processed: data.processed ?? "unknown",
      injectedAt: new Date().toISOString(),
    };
    events.push(row);
    return { inserted: true, row: { ...row } };
  };

  return {
    _events: events,
    findByDedupeKey,
    insertIgnoreOnDuplicate,
    setOutcome: (data) => {
      const idx = events.findIndex(
        (e) =>
          e.hogletTaskId === data.hogletTaskId &&
          e.source === data.source &&
          e.payloadHash === data.payloadHash,
      );
      if (idx >= 0) {
        const next: FeedbackEvent = {
          ...events[idx],
          routedOutcome: data.routedOutcome,
          nestId: data.nestId,
          payloadRef: data.payloadRef,
          trustTier: data.trustTier ?? events[idx].trustTier,
          processed: data.processed ?? events[idx].processed ?? "unknown",
        };
        events[idx] = next;
        return { inserted: false, row: { ...next } };
      }
      return insertIgnoreOnDuplicate(data);
    },
    tryReservePending: (data) => {
      const { inserted, row } = insertIgnoreOnDuplicate({
        ...data,
        routedOutcome: "pending",
      });
      return { reserved: inserted, row };
    },
    listForNest: (nestId, limit) =>
      events
        .filter((e) => e.nestId === nestId)
        .sort((a, b) => (a.injectedAt < b.injectedAt ? 1 : -1))
        .slice(0, limit)
        .map((e) => ({ ...e })),
  };
}
