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

  return {
    _events: events,
    findByDedupeKey,
    insertIgnoreOnDuplicate: (data) => {
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
        injectedAt: new Date().toISOString(),
      };
      events.push(row);
      return { inserted: true, row: { ...row } };
    },
    listForNest: (nestId, limit) =>
      events
        .filter((e) => e.nestId === nestId)
        .sort((a, b) => (a.injectedAt < b.injectedAt ? 1 : -1))
        .slice(0, limit)
        .map((e) => ({ ...e })),
  };
}
