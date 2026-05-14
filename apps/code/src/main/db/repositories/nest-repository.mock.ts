import type { CreateNestData, Nest, UpdateNestData } from "./nest-repository";

export interface MockNestRepository {
  _nests: Map<string, Nest>;
  findById(id: string): Nest | null;
  findAll(): Nest[];
  findAllVisible(): Nest[];
  create(data: CreateNestData): Nest;
  update(id: string, data: UpdateNestData): Nest | null;
  archive(id: string): Nest | null;
  unarchive(id: string): Nest | null;
}

export function createMockNestRepository(): MockNestRepository {
  const nests = new Map<string, Nest>();
  const now = () => new Date().toISOString();

  const findById = (id: string): Nest | null => nests.get(id) ?? null;

  const update = (id: string, data: UpdateNestData): Nest | null => {
    const existing = nests.get(id);
    if (!existing) return null;
    const updated: Nest = { ...existing, ...data, updatedAt: now() };
    nests.set(id, updated);
    return { ...updated };
  };

  return {
    _nests: nests,
    findById: (id: string) => {
      const n = findById(id);
      return n ? { ...n } : null;
    },
    findAll: () => [...nests.values()].map((n) => ({ ...n })),
    findAllVisible: () =>
      [...nests.values()]
        .filter((n) => n.status !== "archived")
        .map((n) => ({ ...n })),
    create: (data: CreateNestData) => {
      const timestamp = now();
      const nest: Nest = {
        id: crypto.randomUUID(),
        name: data.name,
        goalPrompt: data.goalPrompt,
        definitionOfDone: data.definitionOfDone ?? null,
        mapX: data.mapX,
        mapY: data.mapY,
        status: "active",
        health: "ok",
        targetMetricId: null,
        loadoutJson: "{}",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      nests.set(nest.id, nest);
      return { ...nest };
    },
    update,
    archive: (id: string) => update(id, { status: "archived" }),
    unarchive: (id: string) => update(id, { status: "active" }),
  };
}
