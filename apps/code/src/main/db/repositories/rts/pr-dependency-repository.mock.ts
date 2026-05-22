import type {
  CreatePrDependencyData,
  PrDependency,
  PrDependencyState,
} from "./pr-dependency-repository";

export interface MockPrDependencyRepository {
  _rows: PrDependency[];
  insert(data: CreatePrDependencyData): PrDependency;
  insertOrIgnore(data: CreatePrDependencyData): {
    inserted: boolean;
    row: PrDependency;
  };
  findById(id: string): PrDependency | null;
  findByTriple(key: {
    nestId: string;
    parentTaskId: string;
    childTaskId: string;
  }): PrDependency | null;
  findPending(): PrDependency[];
  findByParentTaskId(parentTaskId: string): PrDependency[];
  findByChildTaskId(childTaskId: string): PrDependency[];
  listForNest(nestId: string): PrDependency[];
  updateState(id: string, state: PrDependencyState): PrDependency;
  delete(id: string): void;
}

export function createMockPrDependencyRepository(): MockPrDependencyRepository {
  const rows: PrDependency[] = [];

  function findByTriple(key: {
    nestId: string;
    parentTaskId: string;
    childTaskId: string;
  }): PrDependency | null {
    return (
      rows.find(
        (r) =>
          r.nestId === key.nestId &&
          r.parentTaskId === key.parentTaskId &&
          r.childTaskId === key.childTaskId,
      ) ?? null
    );
  }

  function insert(data: CreatePrDependencyData): PrDependency {
    const timestamp = new Date().toISOString();
    const row: PrDependency = {
      id: crypto.randomUUID(),
      nestId: data.nestId,
      parentTaskId: data.parentTaskId,
      childTaskId: data.childTaskId,
      state: data.state,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    rows.push(row);
    return { ...row };
  }

  return {
    _rows: rows,
    insert,
    insertOrIgnore: (data) => {
      const existing = findByTriple({
        nestId: data.nestId,
        parentTaskId: data.parentTaskId,
        childTaskId: data.childTaskId,
      });
      if (existing) return { inserted: false, row: { ...existing } };
      return { inserted: true, row: insert(data) };
    },
    findById: (id) => {
      const row = rows.find((r) => r.id === id);
      return row ? { ...row } : null;
    },
    findByTriple: (key) => {
      const row = findByTriple(key);
      return row ? { ...row } : null;
    },
    findPending: () =>
      rows.filter((r) => r.state === "pending").map((r) => ({ ...r })),
    findByParentTaskId: (parentTaskId) =>
      rows
        .filter((r) => r.parentTaskId === parentTaskId)
        .map((r) => ({ ...r })),
    findByChildTaskId: (childTaskId) =>
      rows.filter((r) => r.childTaskId === childTaskId).map((r) => ({ ...r })),
    listForNest: (nestId) =>
      rows.filter((r) => r.nestId === nestId).map((r) => ({ ...r })),
    updateState: (id, state) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) throw new Error(`pr dependency ${id} not found`);
      const next: PrDependency = {
        ...rows[idx],
        state,
        updatedAt: new Date().toISOString(),
      };
      rows[idx] = next;
      return { ...next };
    },
    delete: (id) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) rows.splice(idx, 1);
    },
  };
}
