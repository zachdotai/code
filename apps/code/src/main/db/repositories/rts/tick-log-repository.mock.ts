import type { InsertTickLogData, TickLog } from "./tick-log-repository";

export interface MockTickLogRepository {
  _logs: TickLog[];
  insert(data: InsertTickLogData): TickLog;
  countSince(nestId: string, sinceIso: string): number;
}

export function createMockTickLogRepository(): MockTickLogRepository {
  const logs: TickLog[] = [];
  return {
    _logs: logs,
    insert: (data) => {
      const row: TickLog = {
        id: crypto.randomUUID(),
        nestId: data.nestId,
        tickedAt: data.tickedAt ?? new Date().toISOString(),
        outcome: data.outcome,
      };
      logs.push(row);
      return { ...row };
    },
    countSince: (nestId, sinceIso) =>
      logs.filter((l) => l.nestId === nestId && l.tickedAt > sinceIso).length,
  };
}
