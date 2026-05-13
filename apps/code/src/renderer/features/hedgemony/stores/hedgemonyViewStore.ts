import { electronStorage } from "@utils/electronStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

interface HedgemonyViewState {
  panX: number;
  panY: number;
  zoom: number;
}

interface HedgemonyViewActions {
  setPan: (x: number, y: number) => void;
  setZoom: (zoom: number) => void;
  resetView: () => void;
}

type HedgemonyViewStore = HedgemonyViewState & HedgemonyViewActions;

const DEFAULT_VIEW: HedgemonyViewState = {
  panX: 0,
  panY: 0,
  zoom: 1,
};

export const useHedgemonyViewStore = create<HedgemonyViewStore>()(
  persist(
    (set) => ({
      ...DEFAULT_VIEW,
      setPan: (x, y) => set({ panX: x, panY: y }),
      setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
      resetView: () => set(DEFAULT_VIEW),
    }),
    {
      name: "hedgemony-view-storage",
      storage: electronStorage,
      partialize: (state) => ({
        panX: state.panX,
        panY: state.panY,
        zoom: state.zoom,
      }),
    },
  ),
);

export const HEDGEMONY_ZOOM_MIN = ZOOM_MIN;
export const HEDGEMONY_ZOOM_MAX = ZOOM_MAX;
