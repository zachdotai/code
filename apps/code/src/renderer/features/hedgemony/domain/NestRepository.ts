import type { HedgehogStateView, Nest } from "@main/services/hedgemony/schemas";

/**
 * Watcher for nest-set membership transitions. Used by the nest subscription
 * initializer to open/close per-nest watches as ids appear and disappear.
 * Returns a disposer.
 */
export type NestKeysListener = (added: string[], removed: string[]) => void;

/**
 * Narrow interface over nest state used by mutations and subscription
 * orchestration. Zustand is one implementation; in-memory fakes drive unit
 * tests.
 */
export interface NestRepository {
  upsert(nest: Nest): void;
  remove(id: string): void;
  setAll(nests: Nest[]): void;
  setHedgehogState(nestId: string, state: HedgehogStateView): void;
  subscribeToKeys(listener: NestKeysListener): () => void;
}
