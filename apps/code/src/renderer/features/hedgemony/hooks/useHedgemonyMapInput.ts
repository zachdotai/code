import { genderForName } from "@main/services/hedgemony/hoglet-names";
import type { Nest } from "@main/services/hedgemony/schemas";
import { useCallback } from "react";
import { playSfx } from "../audio/sfx";
import { playVoice } from "../audio/voice";
import type { MapBoxSelection } from "../components/HedgemonyMapSurface";
import type { NestCreationMode } from "../components/placeNestDialogReducer";
import { BUILDER_NAME } from "../constants/map";
import { moveNest } from "../service/nestMutations";
import {
  computeMapClickAction,
  type ViewMode,
} from "../state/computeMapClickAction";
import {
  applyBoxSelect as applyBoxSelectController,
  type Selection,
} from "../state/HedgemonyController";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { selectHogletById, useHogletStore } from "../stores/hogletStore";
import { selectNests, useNestStore } from "../stores/nestStore";
import { collectHogletWorldPositions } from "../utils/hogletPositions";
import { applyHogletVisualPositions } from "../utils/hogletVisualPositions";
import { findPath, type Obstacle, type Vec2 } from "../utils/pathfinding";
import {
  BUILDER_OBSTACLE_RADIUS,
  HOGLET_RADIUS,
  hogletObstacles,
  worldObstacles,
} from "../utils/worldObstacles";
import type { BuilderCoordinator } from "./useBuilderCoordinator";

interface UnitObstaclesOptions {
  excludeHogletIds?: ReadonlySet<string>;
  includeBuilder: boolean;
}

export interface UseHedgemonyMapInputOptions {
  mode: ViewMode;
  selection: Selection;
  nests: Nest[];
  builder: BuilderCoordinator;
  builderPosOrFallback: () => Vec2;
  setMode: (next: ViewMode) => void;
  setSelection: (next: Selection | ((prev: Selection) => Selection)) => void;
  setPendingPlacement: (
    placement: { x: number; y: number; creationMode: NestCreationMode } | null,
  ) => void;
  flashMoveMarker: (x: number, y: number) => void;
}

export interface HedgemonyMapInput {
  handleMapClick: (x: number, y: number) => void;
  handleMapRightClick: (x: number, y: number) => void;
  handleBoxSelect: (selection: MapBoxSelection) => void;
  /** Snapshot the current hoglet positions + builder position into an
   * obstacle list. Useful for callers (e.g. PlaceNestDialog after-effect)
   * that need to plan a walk to a freshly-placed nest. */
  unitObstacles: (options: UnitObstaclesOptions) => Obstacle[];
}

/**
 * Click / right-click / marquee input handlers for the map. Owns nothing —
 * dispatches to the controller for selection transitions, to `moveNest` for
 * nest relocation, and to the builder for walks.
 */
export function useHedgemonyMapInput({
  mode,
  selection,
  nests,
  builder,
  builderPosOrFallback,
  setMode,
  setSelection,
  setPendingPlacement,
  flashMoveMarker,
}: UseHedgemonyMapInputOptions): HedgemonyMapInput {
  const collectLiveHogletPositions = useCallback(() => {
    return applyHogletVisualPositions(
      collectHogletWorldPositions(
        selectNests(useNestStore.getState()),
        useHogletStore.getState().byBucket,
        useHogletPositionStore.getState().positions,
      ),
    );
  }, []);

  const unitObstacles = useCallback(
    ({
      excludeHogletIds,
      includeBuilder,
    }: UnitObstaclesOptions): Obstacle[] => {
      const obstacles = hogletObstacles(
        collectLiveHogletPositions(),
        excludeHogletIds,
      );
      if (includeBuilder) {
        const pos = builderPosOrFallback();
        obstacles.push({
          x: pos.x,
          y: pos.y,
          radius: BUILDER_OBSTACLE_RADIUS,
        });
      }
      return obstacles;
    },
    [builderPosOrFallback, collectLiveHogletPositions],
  );

  const handleMapClick = useCallback(
    (x: number, y: number) => {
      const { nextMode, action } = computeMapClickAction({
        mode,
        click: { x, y },
        nests,
      });
      setMode(nextMode);
      switch (action.kind) {
        case "moveNest": {
          flashMoveMarker(action.mapX, action.mapY);
          playSfx("order");
          playVoice("hoglet:order_move", genderForName(BUILDER_NAME));
          void moveNest(action.nest, action.mapX, action.mapY, {
            undoable: true,
            flashMoveMarker,
          });
          return;
        }
        case "placeNest": {
          setPendingPlacement({
            x: action.x,
            y: action.y,
            creationMode: action.creationMode,
          });
          return;
        }
        case "clearSelection": {
          setSelection(null);
          return;
        }
        case "noop":
          return;
      }
    },
    [mode, nests, setMode, setSelection, setPendingPlacement, flashMoveMarker],
  );

  const voiceGenderForHoglet = useCallback((hogletId: string) => {
    const hoglet = selectHogletById(hogletId)(useHogletStore.getState());
    return genderForName(hoglet?.name ?? null);
  }, []);

  const handleMapRightClick = useCallback(
    (x: number, y: number) => {
      if (mode.kind !== "browsing") {
        setMode({ kind: "browsing" });
        return;
      }
      if (!selection || selection.type === "nest") return;

      const targetX = Math.round(x);
      const targetY = Math.round(y);

      if (selection.type === "hoglets") {
        const positionStore = useHogletPositionStore.getState();
        const staticObstacles = worldObstacles(nests);
        const positionsNow = collectLiveHogletPositions();
        const currentById = new Map(
          positionsNow.map((p) => [p.hogletId, { x: p.x, y: p.y }]),
        );
        const desired: { id: string; x: number; y: number }[] =
          selection.ids.length === 1
            ? [{ id: selection.ids[0], x: targetX, y: targetY }]
            : selection.ids.map((id, i) => {
                const ringRadius =
                  HOGLET_RADIUS / Math.sin(Math.PI / selection.ids.length) + 12;
                const angle = (2 * Math.PI * i) / selection.ids.length;
                return {
                  id,
                  x: targetX + Math.cos(angle) * ringRadius,
                  y: targetY + Math.sin(angle) * ringRadius,
                };
              });
        let resolvedX = targetX;
        let resolvedY = targetY;
        for (const slot of desired) {
          const from = currentById.get(slot.id) ?? { x: slot.x, y: slot.y };
          const obstacles = [
            ...staticObstacles,
            ...unitObstacles({
              excludeHogletIds: new Set([slot.id]),
              includeBuilder: true,
            }),
          ];
          const path = findPath(
            from,
            { x: slot.x, y: slot.y },
            obstacles,
            HOGLET_RADIUS,
          );
          if (path.length === 0) continue;
          positionStore.setWalkPath(slot.id, path);
          if (selection.ids.length === 1) {
            const last = path[path.length - 1];
            resolvedX = Math.round(last.x);
            resolvedY = Math.round(last.y);
          }
        }
        if (selection.includeBuilder) {
          builder.startWalk(
            { x: targetX, y: targetY },
            builderPosOrFallback(),
            "idle",
            undefined,
            unitObstacles({ includeBuilder: false }),
          );
        }
        playSfx("order");
        playVoice("hoglet:order_move", voiceGenderForHoglet(selection.ids[0]));
        flashMoveMarker(resolvedX, resolvedY);
        return;
      }

      playSfx("order");
      playVoice("hoglet:order_move", genderForName(BUILDER_NAME));
      const resolved = builder.startWalk(
        { x: targetX, y: targetY },
        builderPosOrFallback(),
        "idle",
        undefined,
        unitObstacles({ includeBuilder: false }),
      );
      flashMoveMarker(Math.round(resolved.x), Math.round(resolved.y));
    },
    [
      mode,
      selection,
      nests,
      builder,
      builderPosOrFallback,
      collectLiveHogletPositions,
      unitObstacles,
      voiceGenderForHoglet,
      flashMoveMarker,
      setMode,
    ],
  );

  const handleBoxSelect = useCallback(
    ({ minX, minY, maxX, maxY, additive }: MapBoxSelection) => {
      const nestsNow = selectNests(useNestStore.getState());
      const byBucket = useHogletStore.getState().byBucket;
      const overrides = useHogletPositionStore.getState().positions;
      const positions = applyHogletVisualPositions(
        collectHogletWorldPositions(nestsNow, byBucket, overrides),
      );
      const hit = positions
        .filter((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)
        .map((p) => p.hogletId);

      // Hit-test the builder at its live on-screen position so the marquee
      // catches him alongside any hoglets in the same drag.
      const builderPos = builderPosOrFallback();
      const builderInRect =
        builderPos.x >= minX &&
        builderPos.x <= maxX &&
        builderPos.y >= minY &&
        builderPos.y <= maxY;

      setSelection((prev) =>
        applyBoxSelectController(prev, hit, builderInRect, additive),
      );
      if (hit.length > 0 || builderInRect) playSfx("select");
    },
    [builderPosOrFallback, setSelection],
  );

  return {
    handleMapClick,
    handleMapRightClick,
    handleBoxSelect,
    unitObstacles,
  };
}
