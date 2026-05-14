import type {
  CreateHogletData,
  Hoglet,
  IncrementUsageData,
  UpdateHogletData,
} from "./hoglet-repository";

export interface MockHogletRepository {
  _hoglets: Map<string, Hoglet>;
  findById(id: string): Hoglet | null;
  findByTaskId(taskId: string): Hoglet | null;
  findAllWild(): Hoglet[];
  findAllForNest(nestId: string): Hoglet[];
  findAllNames(): string[];
  countWild(): number;
  create(data: CreateHogletData): Hoglet;
  incrementUsage(id: string, data: IncrementUsageData): void;
  update(id: string, data: UpdateHogletData): Hoglet | null;
  softDelete(id: string): Hoglet | null;
}

export function createMockHogletRepository(): MockHogletRepository {
  const hoglets = new Map<string, Hoglet>();
  const taskIndex = new Map<string, string>();
  const now = () => new Date().toISOString();

  const clone = (h: Hoglet | null): Hoglet | null => (h ? { ...h } : null);

  const isWild = (h: Hoglet) => !h.nestId && !h.signalReportId && !h.deletedAt;

  const findById = (id: string): Hoglet | null => hoglets.get(id) ?? null;

  return {
    _hoglets: hoglets,
    findById: (id: string) => clone(findById(id)),
    findByTaskId: (taskId: string) => {
      const id = taskIndex.get(taskId);
      return clone(id ? findById(id) : null);
    },
    findAllWild: () =>
      [...hoglets.values()].filter(isWild).map((h) => ({ ...h })),
    findAllForNest: (nestId: string) =>
      [...hoglets.values()]
        .filter((h) => h.nestId === nestId && !h.deletedAt)
        .map((h) => ({ ...h })),
    findAllNames: () =>
      [...hoglets.values()]
        .filter((h) => !h.deletedAt)
        .map((h) => h.name)
        .filter((n): n is string => n !== null),
    countWild: () => [...hoglets.values()].filter(isWild).length,
    create: (data: CreateHogletData) => {
      const timestamp = now();
      const hoglet: Hoglet = {
        id: crypto.randomUUID(),
        name: data.name ?? null,
        taskId: data.taskId,
        nestId: data.nestId ?? null,
        signalReportId: data.signalReportId ?? null,
        affinityScore: data.affinityScore ?? null,
        model: data.model ?? null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        totalCostUsd: 0,
        lastUsageAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };
      hoglets.set(hoglet.id, hoglet);
      taskIndex.set(hoglet.taskId, hoglet.id);
      return { ...hoglet };
    },
    incrementUsage: (id: string, data: IncrementUsageData) => {
      const existing = hoglets.get(id);
      if (!existing) return;
      hoglets.set(id, {
        ...existing,
        totalInputTokens: existing.totalInputTokens + data.inputTokens,
        totalOutputTokens: existing.totalOutputTokens + data.outputTokens,
        totalCacheReadTokens:
          existing.totalCacheReadTokens + data.cacheReadTokens,
        totalCacheCreationTokens:
          existing.totalCacheCreationTokens + data.cacheCreationTokens,
        totalCostUsd: existing.totalCostUsd + data.costUsd,
        lastUsageAt: data.occurredAt,
        updatedAt: now(),
      });
    },
    update: (id: string, data: UpdateHogletData) => {
      const existing = hoglets.get(id);
      if (!existing) return null;
      const updated: Hoglet = { ...existing, ...data, updatedAt: now() };
      hoglets.set(id, updated);
      return { ...updated };
    },
    softDelete: (id: string) => {
      const existing = hoglets.get(id);
      if (!existing) return null;
      const timestamp = now();
      const deleted: Hoglet = {
        ...existing,
        deletedAt: timestamp,
        updatedAt: timestamp,
      };
      hoglets.set(id, deleted);
      return { ...deleted };
    },
  };
}
