import type {
  HedgehogState,
  HedgehogTickState,
  UpsertHedgehogStateData,
} from "./hedgehog-state-repository";

export interface MockHedgehogStateRepository {
  _states: Map<string, HedgehogState>;
  findByNestId(nestId: string): HedgehogState | null;
  upsert(data: UpsertHedgehogStateData): HedgehogState;
  resetStuckTicks(): HedgehogState[];
  delete(nestId: string): void;
}

export function createMockHedgehogStateRepository(): MockHedgehogStateRepository {
  const states = new Map<string, HedgehogState>();
  const now = () => new Date().toISOString();
  const clone = (s: HedgehogState | null): HedgehogState | null =>
    s ? { ...s } : null;

  return {
    _states: states,
    findByNestId: (nestId) => clone(states.get(nestId) ?? null),
    upsert: (data) => {
      const existing = states.get(data.nestId);
      const timestamp = now();
      const next: HedgehogState = existing
        ? {
            ...existing,
            ...(data.state !== undefined ? { state: data.state } : {}),
            ...(data.lastTickAt !== undefined
              ? { lastTickAt: data.lastTickAt }
              : {}),
            ...(data.serializedStateJson !== undefined
              ? { serializedStateJson: data.serializedStateJson }
              : {}),
            updatedAt: timestamp,
          }
        : {
            nestId: data.nestId,
            state: (data.state ?? "idle") as HedgehogTickState,
            lastTickAt: data.lastTickAt ?? null,
            serializedStateJson: data.serializedStateJson ?? null,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
      states.set(data.nestId, next);
      return { ...next };
    },
    resetStuckTicks: () => {
      const reset: HedgehogState[] = [];
      for (const [nestId, state] of states) {
        if (state.state === "ticking") {
          const next: HedgehogState = {
            ...state,
            state: "idle",
            updatedAt: now(),
          };
          states.set(nestId, next);
          reset.push({ ...next });
        }
      }
      return reset;
    },
    delete: (nestId) => {
      states.delete(nestId);
    },
  };
}
