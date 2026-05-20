import { electronStorage } from "@utils/electronStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { HEDGEMONY_CONFIG } from "../config";

const ZOOM_MIN = HEDGEMONY_CONFIG.camera.zoomMin;
const ZOOM_MAX = HEDGEMONY_CONFIG.camera.zoomMax;

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
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
  bookmarks: BookmarkMap;
}

interface HedgemonyViewActions {
  setPan: (x: number, y: number) => void;
  setZoom: (zoom: number) => void;
  setView: (panX: number, panY: number, zoom: number) => void;
  resetView: () => void;
  setFullscreen: (value: boolean) => void;
  setOsFullscreen: (value: boolean) => void;
  saveBookmark: (slot: BookmarkSlot) => void;
  clearBookmark: (slot: BookmarkSlot) => void;
}

type HedgemonyViewStore = HedgemonyViewState & HedgemonyViewActions;

const DEFAULT_VIEW: Omit<
  HedgemonyViewState,
  "fullscreen" | "osFullscreen" | "bookmarks"
> = {
  panX: 0,
  panY: 0,
  zoom: 1,
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
        bookmarks: state.bookmarks,
      }),
    },
  ),
);

export const HEDGEMONY_ZOOM_MIN = ZOOM_MIN;
export const HEDGEMONY_ZOOM_MAX = ZOOM_MAX;
