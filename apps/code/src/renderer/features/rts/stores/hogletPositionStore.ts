import { electronStorage } from "@utils/electronStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Vec2 } from "../utils/pathfinding";

interface HogletPositionState {
  /** World-space overrides keyed by hoglet id. Absent → use default layout. */
  positions: Record<string, { x: number; y: number }>;
  /** Multi-waypoint walk paths keyed by hoglet id. When present, the sprite
   * walks through every waypoint in order; absent → straight-line tween to
   * `positions[id]`. Not persisted: a half-walked path on restart should just
   * snap to the final position. */
  walkPaths: Record<string, Vec2[]>;
}

interface HogletPositionActions {
  setPosition: (hogletId: string, x: number, y: number) => void;
  /** Set both the final position (last waypoint) and the intermediate walk
   * route. Use this instead of `setPosition` whenever pathfinding produced
   * more than two points, so the sprite visibly routes around obstacles. */
  setWalkPath: (hogletId: string, path: Vec2[]) => void;
  clearPosition: (hogletId: string) => void;
  reset: () => void;
}

type HogletPositionStore = HogletPositionState & HogletPositionActions;

export const useHogletPositionStore = create<HogletPositionStore>()(
  persist(
    (set) => ({
      positions: {},
      walkPaths: {},
      setPosition: (hogletId, x, y) =>
        set((state) => {
          const nextPositions = {
            ...state.positions,
            [hogletId]: { x: Math.round(x), y: Math.round(y) },
          };
          if (!(hogletId in state.walkPaths)) {
            return { positions: nextPositions };
          }
          const nextPaths = { ...state.walkPaths };
          delete nextPaths[hogletId];
          return { positions: nextPositions, walkPaths: nextPaths };
        }),
      setWalkPath: (hogletId, path) =>
        set((state) => {
          if (path.length === 0) return state;
          const last = path[path.length - 1];
          return {
            positions: {
              ...state.positions,
              [hogletId]: { x: Math.round(last.x), y: Math.round(last.y) },
            },
            walkPaths: { ...state.walkPaths, [hogletId]: path },
          };
        }),
      clearPosition: (hogletId) =>
        set((state) => {
          const inPositions = hogletId in state.positions;
          const inPaths = hogletId in state.walkPaths;
          if (!inPositions && !inPaths) return state;
          const nextPositions = { ...state.positions };
          const nextPaths = { ...state.walkPaths };
          delete nextPositions[hogletId];
          delete nextPaths[hogletId];
          return { positions: nextPositions, walkPaths: nextPaths };
        }),
      reset: () => set({ positions: {}, walkPaths: {} }),
    }),
    {
      name: "hedgemony-hoglet-positions",
      storage: electronStorage,
      partialize: (state) => ({ positions: state.positions }),
    },
  ),
);

export const selectHogletPosition =
  (hogletId: string) =>
  (state: HogletPositionStore): { x: number; y: number } | undefined =>
    state.positions[hogletId];

export const selectHogletWalkPath =
  (hogletId: string) =>
  (state: HogletPositionStore): Vec2[] | undefined =>
    state.walkPaths[hogletId];
