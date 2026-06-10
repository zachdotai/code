import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { FALLBACK_MODELS, type ModelOption } from "../composer/options";

/** Caches the last model list downloaded from the LLM gateway so the picker
 *  renders instantly on a cold start while `useModels` refetches in the
 *  background. Seeded with the built-in fallback so it's never empty. */
interface ModelCacheState {
  models: ModelOption[];
  setModels: (models: ModelOption[]) => void;
}

export const useModelStore = create<ModelCacheState>()(
  persist(
    (set) => ({
      models: FALLBACK_MODELS,
      setModels: (models) => set({ models }),
    }),
    {
      name: "ph-model-cache",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
