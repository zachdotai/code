import type {
  CreatePrDependencyData,
  PrDependency,
} from "./pr-dependency-repository";

export interface MockPrDependencyRepository {
  _rows: PrDependency[];
  insert(data: CreatePrDependencyData): PrDependency;
  listForNest(nestId: string): PrDependency[];
}

export function createMockPrDependencyRepository(): MockPrDependencyRepository {
  const rows: PrDependency[] = [];
  return {
    _rows: rows,
    insert: (data) => {
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
    },
    listForNest: (nestId) =>
      rows.filter((r) => r.nestId === nestId).map((r) => ({ ...r })),
  };
}
