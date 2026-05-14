import type { Nest } from "@main/services/hedgemony/schemas";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  initializeNestStore,
  selectNests,
  useNestStore,
} from "../stores/nestStore";
import { useSpawnDialogStore } from "../stores/spawnDialogStore";
import {
  findPath,
  type Obstacle,
  snapGoal,
  type Vec2,
} from "../utils/pathfinding";
import { BuilderCommandPanel } from "./BuilderCommandPanel";
import type { BuilderAnimation } from "./BuilderSprite";
import { HedgemonyEmptyState } from "./HedgemonyEmptyState";
import { HedgemonyHoldingPanel } from "./HedgemonyHoldingPanel";
import { HedgemonyMapSurface, type MoveMarker } from "./HedgemonyMapSurface";
import { NestDetailPanel } from "./NestDetailPanel";
import { type NestCreationMode, PlaceNestDialog } from "./PlaceNestDialog";
import { SpawnHogletDialog } from "./SpawnHogletDialog";

const log = logger.scope("hedgemony-map-view");

const BUILD_ANIMATION_MS = 1500;
const NEST_OBSTACLE_RADIUS = 56;
const INITIAL_BUILDER_POS: Vec2 = { x: 0, y: 0 };

type Selection = { type: "nest"; id: string } | { type: "builder" } | null;

type BuilderState =
  | { kind: "idle" }
  | { kind: "walking"; onArrive: "idle" | "build" }
  | { kind: "building" };

export function HedgemonyMapView() {
  const nests = useNestStore(selectNests);
  const loaded = useNestStore((s) => s.loaded);

  const [pendingPlacement, setPendingPlacement] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [builderPath, setBuilderPath] = useState<Vec2[]>([INITIAL_BUILDER_POS]);
  const [lastReachedIndex, setLastReachedIndex] = useState(0);
  const [builderState, setBuilderState] = useState<BuilderState>({
    kind: "idle",
  });
  const [buildMode, setBuildMode] = useState(false);
  const [relocatingNestId, setRelocatingNestId] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<NestCreationMode>("guided");
  const [moveMarker, setMoveMarker] = useState<MoveMarker | null>(null);
  const buildingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Authoritative on-screen position of the builder sprite, updated by
  // BuilderSprite each motion frame. Used as the start point for re-plans so
  // the path begins where the sprite visually is — not at the last waypoint
  // it nominally reached. Otherwise Framer Motion animates straight from the
  // current screen position to path[1], which can clip through obstacles.
  const builderVisualPosRef = useRef<Vec2>({ ...INITIAL_BUILDER_POS });
  const spawnHogletOpen = useSpawnDialogStore((s) => s.spawnHogletOpen);
  const closeSpawnHoglet = useSpawnDialogStore((s) => s.closeSpawnHoglet);

  const builderPos: Vec2 = builderPath[lastReachedIndex] ?? INITIAL_BUILDER_POS;

  useEffect(() => {
    return initializeNestStore();
  }, []);

  useEffect(() => {
    return () => {
      if (buildingTimerRef.current) clearTimeout(buildingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (relocatingNestId) {
        setRelocatingNestId(null);
        return;
      }
      if (buildMode) {
        setBuildMode(false);
        return;
      }
      if (selection) setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [buildMode, relocatingNestId, selection]);

  const flashMoveMarker = useCallback((x: number, y: number) => {
    const id = Date.now();
    setMoveMarker({ id, x, y });
    setTimeout(() => {
      setMoveMarker((current) => (current?.id === id ? null : current));
    }, 600);
  }, []);

  async function moveNest(
    nest: Nest,
    mapX: number,
    mapY: number,
    options: { undoable?: boolean } = {},
  ) {
    const previous = nest;
    useNestStore.getState().upsert({ ...nest, mapX, mapY });
    try {
      const updated = await trpcClient.hedgemony.nests.update.mutate({
        id: nest.id,
        mapX,
        mapY,
      });
      useNestStore.getState().upsert(updated);
      if (options.undoable) {
        toast("Nest moved", {
          action: {
            label: "Undo",
            onClick: () => {
              flashMoveMarker(previous.mapX, previous.mapY);
              void moveNest(updated, previous.mapX, previous.mapY);
            },
          },
        });
      }
    } catch (error) {
      log.error("Failed to move nest", { id: nest.id, error });
      useNestStore.getState().upsert(previous);
      toast.error("Could not move nest");
    }
  }

  const enterBuilding = useCallback(() => {
    if (buildingTimerRef.current) clearTimeout(buildingTimerRef.current);
    setBuilderState({ kind: "building" });
    buildingTimerRef.current = setTimeout(() => {
      setBuilderState({ kind: "idle" });
      buildingTimerRef.current = null;
    }, BUILD_ANIMATION_MS);
  }, []);

  const startWalk = useCallback(
    (target: Vec2, onArrive: "idle" | "build"): Vec2 => {
      if (buildingTimerRef.current) {
        clearTimeout(buildingTimerRef.current);
        buildingTimerRef.current = null;
      }
      const from = builderVisualPosRef.current;
      const obstacles: Obstacle[] = nests.map((nest) => ({
        x: nest.mapX,
        y: nest.mapY,
        radius: NEST_OBSTACLE_RADIUS,
      }));
      const snapped = snapGoal(from, target, obstacles);
      const path = findPath(from, snapped, obstacles);
      const resolvedGoal = path[path.length - 1] ?? snapped;
      if (path.length < 2) {
        setBuilderPath(path.length === 1 ? path : [from]);
        setLastReachedIndex(0);
        if (onArrive === "build") enterBuilding();
        else setBuilderState({ kind: "idle" });
        return resolvedGoal;
      }
      setBuilderPath(path);
      setLastReachedIndex(0);
      setBuilderState({ kind: "walking", onArrive });
      return resolvedGoal;
    },
    [nests, enterBuilding],
  );

  const handleBuilderArrive = useCallback(() => {
    setBuilderState((current) => {
      if (current.kind !== "walking") return current;
      if (current.onArrive === "build") {
        enterBuilding();
        return { kind: "building" };
      }
      return { kind: "idle" };
    });
  }, [enterBuilding]);

  const handleBuilderSegmentComplete = useCallback((index: number) => {
    setLastReachedIndex(index);
  }, []);

  const handleMapClick = (x: number, y: number) => {
    if (relocatingNestId) {
      const nest = nests.find((n) => n.id === relocatingNestId);
      if (!nest) {
        setRelocatingNestId(null);
        return;
      }
      const targetX = Math.round(x);
      const targetY = Math.round(y);
      setRelocatingNestId(null);
      flashMoveMarker(targetX, targetY);
      void moveNest(nest, targetX, targetY, { undoable: true });
      return;
    }
    if (buildMode) {
      setBuildMode(false);
      setPendingPlacement({ x, y });
      return;
    }
    setSelection(null);
  };

  const handleMapRightClick = (x: number, y: number) => {
    if (relocatingNestId) {
      setRelocatingNestId(null);
      return;
    }
    if (buildMode) {
      setBuildMode(false);
      return;
    }
    if (!selection) return;

    const targetX = Math.round(x);
    const targetY = Math.round(y);

    if (selection.type === "nest") return;

    const resolved = startWalk({ x: targetX, y: targetY }, "idle");
    flashMoveMarker(Math.round(resolved.x), Math.round(resolved.y));
  };

  const showEmptyState = loaded && nests.length === 0;
  const activeNest =
    selection?.type === "nest"
      ? (nests.find((nest) => nest.id === selection.id) ?? null)
      : null;
  const builderSelected = selection?.type === "builder";

  const builderAnimation: BuilderAnimation =
    builderState.kind === "walking"
      ? "walking"
      : builderState.kind === "building"
        ? "building"
        : "idle";

  const beginBuildNest = () => {
    setRelocatingNestId(null);
    setPendingMode("guided");
    setBuildMode(true);
    setSelection({ type: "builder" });
  };

  const beginQuickNest = () => {
    setRelocatingNestId(null);
    setPendingMode("simple");
    setBuildMode(true);
    setSelection({ type: "builder" });
  };

  const beginRelocateNest = (id: string) => {
    setBuildMode(false);
    setRelocatingNestId(id);
  };

  return (
    <>
      <HedgemonyMapSurface
        nests={nests}
        selectedNestId={activeNest?.id ?? null}
        relocatingNestId={relocatingNestId}
        builderPath={builderPath}
        builderPos={builderPos}
        builderPositionRef={builderVisualPosRef}
        builderSelected={builderSelected}
        builderAnimation={builderAnimation}
        buildMode={buildMode}
        moveMarker={moveMarker}
        overlay={
          showEmptyState && !buildMode ? (
            <HedgemonyEmptyState onBuildFirstNest={beginBuildNest} />
          ) : null
        }
        onMapClick={handleMapClick}
        onMapRightClick={handleMapRightClick}
        onNestSelect={(nest) => setSelection({ type: "nest", id: nest.id })}
        onBuilderSelect={() => setSelection({ type: "builder" })}
        onBuilderArrive={handleBuilderArrive}
        onBuilderSegmentComplete={handleBuilderSegmentComplete}
      />
      {activeNest && (
        <NestDetailPanel
          nest={activeNest}
          onClose={() => {
            setRelocatingNestId(null);
            setSelection(null);
          }}
          onRelocate={() => beginRelocateNest(activeNest.id)}
        />
      )}
      <AnimatePresence>
        {builderSelected && !buildMode && (
          <BuilderCommandPanel
            onBuildNest={beginBuildNest}
            onQuickNest={beginQuickNest}
            onClose={() => setSelection(null)}
          />
        )}
      </AnimatePresence>
      <PlaceNestDialog
        open={pendingPlacement !== null}
        mapX={pendingPlacement?.x ?? 0}
        mapY={pendingPlacement?.y ?? 0}
        initialMode={pendingMode}
        onClose={() => setPendingPlacement(null)}
        onCreated={(mapX, mapY) => {
          startWalk({ x: mapX, y: mapY }, "build");
        }}
      />
      <HedgemonyHoldingPanel />
      <SpawnHogletDialog open={spawnHogletOpen} onClose={closeSpawnHoglet} />
    </>
  );
}
