import { electronStorage } from "@utils/electronStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

interface HoldingPanelState {
  open: boolean;
  collapsed: boolean;
  x: number;
  y: number;
}

interface HedgemonyViewState {
  panX: number;
  panY: number;
  zoom: number;
  holdingPanel: HoldingPanelState;
}

interface HedgemonyViewActions {
  setPan: (x: number, y: number) => void;
  setZoom: (zoom: number) => void;
  resetView: () => void;
  setHoldingPanelOpen: (open: boolean) => void;
  toggleHoldingPanelCollapsed: () => void;
  setHoldingPanelPosition: (x: number, y: number) => void;
}

type HedgemonyViewStore = HedgemonyViewState & HedgemonyViewActions;

const DEFAULT_HOLDING_PANEL: HoldingPanelState = {
  open: true,
  collapsed: false,
  x: -1, // sentinel: position on first mount relative to viewport
  y: -1,
};

const DEFAULT_VIEW: HedgemonyViewState = {
  panX: 0,
  panY: 0,
  zoom: 1,
  holdingPanel: DEFAULT_HOLDING_PANEL,
};

export const useHedgemonyViewStore = create<HedgemonyViewStore>()(
  persist(
    (set) => ({
      ...DEFAULT_VIEW,
      setPan: (x, y) => set({ panX: x, panY: y }),
      setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
      resetView: () => set(DEFAULT_VIEW),
      setHoldingPanelOpen: (open) =>
        set((state) => ({ holdingPanel: { ...state.holdingPanel, open } })),
      toggleHoldingPanelCollapsed: () =>
        set((state) => ({
          holdingPanel: {
            ...state.holdingPanel,
            collapsed: !state.holdingPanel.collapsed,
          },
        })),
      setHoldingPanelPosition: (x, y) =>
        set((state) => ({
          holdingPanel: { ...state.holdingPanel, x, y },
        })),
    }),
    {
      name: "hedgemony-view-storage",
      storage: electronStorage,
      partialize: (state) => ({
        panX: state.panX,
        panY: state.panY,
        zoom: state.zoom,
        holdingPanel: state.holdingPanel,
      }),
    },
  ),
);

export const HEDGEMONY_ZOOM_MIN = ZOOM_MIN;
export const HEDGEMONY_ZOOM_MAX = ZOOM_MAX;
