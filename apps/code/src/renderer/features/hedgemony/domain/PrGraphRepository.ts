import type { PrDependencyView } from "@main/services/hedgemony/schemas";

/**
 * Narrow interface over per-nest PR-graph edge state used by the
 * pr-graph subscription service.
 */
export interface PrGraphRepository {
  upsert(nestId: string, edge: PrDependencyView): void;
  remove(nestId: string, edgeId: string): void;
  setForNest(nestId: string, edges: PrDependencyView[]): void;
}
