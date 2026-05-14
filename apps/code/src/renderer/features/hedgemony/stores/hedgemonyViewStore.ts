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

export interface CameraView {
  panX: number;
  panY: number;
  zoom: number;
}

export type BookmarkSlot = 1 | 2 | 3;

type BookmarkMap = Partial<Record<BookmarkSlot, CameraView>>;

interface HedgemonyViewState {
  panX: number;
  panY: number;
  zoom: number;
  fullscreen: boolean;
  osFullscreen: boolean;
  holdingPanel: HoldingPanelState;
  bookmarks: BookmarkMap;
}

interface HedgemonyViewActions {
  setPan: (x: number, y: number) => void;
  setZoom: (zoom: number) => void;
  setView: (panX: number, panY: number, zoom: number) => void;
  resetView: () => void;
  setFullscreen: (value: boolean) => void;
  setOsFullscreen: (value: boolean) => void;
  setHoldingPanelOpen: (open: boolean) => void;
  toggleHoldingPanelCollapsed: () => void;
  setHoldingPanelPosition: (x: number, y: number) => void;
  saveBookmark: (slot: BookmarkSlot) => void;
  clearBookmark: (slot: BookmarkSlot) => void;
}

type HedgemonyViewStore = HedgemonyViewState & HedgemonyViewActions;

const DEFAULT_HOLDING_PANEL: HoldingPanelState = {
  open: true,
  collapsed: false,
  x: -1, // sentinel: position on first mount relative to viewport
  y: -1,
};

const DEFAULT_VIEW: Omit<
  HedgemonyViewState,
  "fullscreen" | "osFullscreen" | "bookmarks"
> = {
  panX: 0,
  panY: 0,
  zoom: 1,
  holdingPanel: DEFAULT_HOLDING_PANEL,
};

export const useHedgemonyViewStore = create<HedgemonyViewStore>()(
  persist(
    (set) => ({
      ...DEFAULT_VIEW,
      fullscreen: false,
      osFullscreen: false,
      bookmarks: {},
      setPan: (x, y) => set({ panX: x, panY: y }),
      setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
      setView: (panX, panY, zoom) => set({ panX, panY, zoom: clampZoom(zoom) }),
      resetView: () => set({ ...DEFAULT_VIEW }),
      setFullscreen: (value) => set({ fullscreen: value }),
      setOsFullscreen: (value) => set({ osFullscreen: value }),
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
      saveBookmark: (slot) =>
        set((state) => ({
          bookmarks: {
            ...state.bookmarks,
            [slot]: { panX: state.panX, panY: state.panY, zoom: state.zoom },
          },
        })),
      clearBookmark: (slot) =>
        set((state) => {
          const next = { ...state.bookmarks };
          delete next[slot];
          return { bookmarks: next };
        }),
    }),
    {
      name: "hedgemony-view-storage",
      storage: electronStorage,
      // fullscreen and osFullscreen are intentionally not persisted — they
      // describe transient session state, not user preference.
      partialize: (state) => ({
        panX: state.panX,
        panY: state.panY,
        zoom: state.zoom,
        holdingPanel: state.holdingPanel,
        bookmarks: state.bookmarks,
      }),
    },
  ),
);

export const HEDGEMONY_ZOOM_MIN = ZOOM_MIN;
export const HEDGEMONY_ZOOM_MAX = ZOOM_MAX;
