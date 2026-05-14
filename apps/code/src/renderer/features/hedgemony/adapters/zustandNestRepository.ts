import type { NestRepository } from "../domain/NestRepository";
import { useNestStore } from "../stores/nestStore";

export const zustandNestRepository: NestRepository = {
  upsert(nest) {
    useNestStore.getState().upsert(nest);
  },
  remove(id) {
    useNestStore.getState().remove(id);
  },
  setAll(nests) {
    useNestStore.getState().setAll(nests);
  },
  setHedgehogState(nestId, state) {
    useNestStore.getState().setHedgehogState(nestId, state);
  },
  subscribeToKeys(listener) {
    return useNestStore.subscribe((state, prev) => {
      const current = new Set(Object.keys(state.nests));
      const previous = new Set(Object.keys(prev.nests));
      const added: string[] = [];
      const removed: string[] = [];
      for (const id of current) if (!previous.has(id)) added.push(id);
      for (const id of previous) if (!current.has(id)) removed.push(id);
      if (added.length > 0 || removed.length > 0) {
        listener(added, removed);
      }
    });
  },
};
