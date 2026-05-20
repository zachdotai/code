import { electronStorage } from "@utils/electronStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface BgmState {
  muted: boolean;
  volume: number;
}

interface BgmActions {
  toggleMute: () => void;
  setVolume: (volume: number) => void;
}

type BgmStore = BgmState & BgmActions;

export const useBgmStore = create<BgmStore>()(
  persist(
    (set) => ({
      muted: false,
      volume: 30,
      toggleMute: () => set((s) => ({ muted: !s.muted })),
      setVolume: (volume) =>
        set({ volume: Math.max(0, Math.min(100, volume)) }),
    }),
    {
      name: "rts-bgm-storage",
      storage: electronStorage,
      partialize: (state) => ({ muted: state.muted, volume: state.volume }),
    },
  ),
);
