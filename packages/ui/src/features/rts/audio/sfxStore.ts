import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SfxState {
  muted: boolean;
  volume: number;
}

interface SfxActions {
  toggleMute: () => void;
  setVolume: (volume: number) => void;
}

type SfxStore = SfxState & SfxActions;

export const useSfxStore = create<SfxStore>()(
  persist(
    (set) => ({
      muted: false,
      volume: 60,
      toggleMute: () => set((s) => ({ muted: !s.muted })),
      setVolume: (volume) =>
        set({ volume: Math.max(0, Math.min(100, volume)) }),
    }),
    {
      name: "rts-sfx-storage",
      storage: electronStorage,
      partialize: (state) => ({ muted: state.muted, volume: state.volume }),
    },
  ),
);
