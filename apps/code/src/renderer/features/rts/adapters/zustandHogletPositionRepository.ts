import type { HogletPositionRepository } from "../domain/HogletPositionRepository";
import { useHogletPositionStore } from "../stores/hogletPositionStore";

export const zustandHogletPositionRepository: HogletPositionRepository = {
  clearPosition(hogletId) {
    useHogletPositionStore.getState().clearPosition(hogletId);
  },
  getPosition(hogletId) {
    return useHogletPositionStore.getState().positions[hogletId] ?? null;
  },
};
