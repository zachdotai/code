import type { PrGraphRepository } from "../domain/PrGraphRepository";
import { usePrGraphStore } from "../stores/prGraphStore";

export const zustandPrGraphRepository: PrGraphRepository = {
  upsert(nestId, edge) {
    usePrGraphStore.getState().upsert(nestId, edge);
  },
  remove(nestId, edgeId) {
    usePrGraphStore.getState().remove(nestId, edgeId);
  },
  setForNest(nestId, edges) {
    usePrGraphStore.getState().setForNest(nestId, edges);
  },
};
