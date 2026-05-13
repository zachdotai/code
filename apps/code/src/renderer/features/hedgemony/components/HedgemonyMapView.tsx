import type { Nest } from "@main/services/hedgemony/schemas";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  initializeNestStore,
  selectNests,
  useNestStore,
} from "../stores/nestStore";
import { BuilderCommandPanel } from "./BuilderCommandPanel";
import type { BuilderAnimation } from "./BuilderSprite";
import { HedgemonyEmptyState } from "./HedgemonyEmptyState";
import { HedgemonyMapSurface, type MoveMarker } from "./HedgemonyMapSurface";
import { NestDetailPanel } from "./NestDetailPanel";
import { PlaceNestDialog } from "./PlaceNestDialog";

const log = logger.scope("hedgemony-map-view");

const BUILD_ANIMATION_MS = 1500;

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
  const [builderPos, setBuilderPos] = useState({ x: 0, y: 0 });
  const [builderFacing, setBuilderFacing] = useState<"left" | "right">("right");
  const [builderState, setBuilderState] = useState<BuilderState>({
    kind: "idle",
  });
  const [buildMode, setBuildMode] = useState(false);
  const [moveMarker, setMoveMarker] = useState<MoveMarker | null>(null);
  const buildingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (buildMode) {
        setBuildMode(false);
        return;
      }
      if (selection) setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [buildMode, selection]);

  const flashMoveMarker = useCallback((x: number, y: number) => {
    const id = Date.now();
    setMoveMarker({ id, x, y });
    setTimeout(() => {
      setMoveMarker((current) => (current?.id === id ? null : current));
    }, 600);
  }, []);

  const moveNest = useCallback(
    async (nest: Nest, mapX: number, mapY: number) => {
      const previous = nest;
      useNestStore.getState().upsert({ ...nest, mapX, mapY });
      try {
        const updated = await trpcClient.hedgemony.nests.update.mutate({
          id: nest.id,
          mapX,
          mapY,
        });
        useNestStore.getState().upsert(updated);
      } catch (error) {
        log.error("Failed to move nest", { id: nest.id, error });
        useNestStore.getState().upsert(previous);
      }
    },
    [],
  );

  const enterBuilding = useCallback(() => {
    if (buildingTimerRef.current) clearTimeout(buildingTimerRef.current);
    setBuilderState({ kind: "building" });
    buildingTimerRef.current = setTimeout(() => {
      setBuilderState({ kind: "idle" });
      buildingTimerRef.current = null;
    }, BUILD_ANIMATION_MS);
  }, []);

  const startWalk = useCallback(
    (target: { x: number; y: number }, onArrive: "idle" | "build") => {
      if (buildingTimerRef.current) {
        clearTimeout(buildingTimerRef.current);
        buildingTimerRef.current = null;
      }
      if (target.x === builderPos.x && target.y === builderPos.y) {
        if (onArrive === "build") enterBuilding();
        else setBuilderState({ kind: "idle" });
        return;
      }
      setBuilderFacing(target.x >= builderPos.x ? "right" : "left");
      setBuilderPos(target);
      setBuilderState({ kind: "walking", onArrive });
    },
    [builderPos.x, builderPos.y, enterBuilding],
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

  const handleMapClick = (x: number, y: number) => {
    if (buildMode) {
      setBuildMode(false);
      setPendingPlacement({ x, y });
      return;
    }
    setSelection(null);
  };

  const handleMapRightClick = (x: number, y: number) => {
    if (buildMode) {
      setBuildMode(false);
      return;
    }
    if (!selection) return;

    const targetX = Math.round(x);
    const targetY = Math.round(y);

    if (selection.type === "nest") {
      const nest = nests.find((n) => n.id === selection.id);
      if (!nest) return;
      flashMoveMarker(targetX, targetY);
      void moveNest(nest, targetX, targetY);
      return;
    }

    flashMoveMarker(targetX, targetY);
    startWalk({ x: targetX, y: targetY }, "idle");
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

  return (
    <>
      <HedgemonyMapSurface
        nests={nests}
        selectedNestId={activeNest?.id ?? null}
        builderX={builderPos.x}
        builderY={builderPos.y}
        builderSelected={builderSelected}
        builderAnimation={builderAnimation}
        builderFacing={builderFacing}
        buildMode={buildMode}
        moveMarker={moveMarker}
        overlay={showEmptyState ? <HedgemonyEmptyState /> : null}
        onMapClick={handleMapClick}
        onMapRightClick={handleMapRightClick}
        onNestSelect={(nest) => setSelection({ type: "nest", id: nest.id })}
        onBuilderSelect={() => setSelection({ type: "builder" })}
        onBuilderArrive={handleBuilderArrive}
      />
      {activeNest && (
        <NestDetailPanel nest={activeNest} onClose={() => setSelection(null)} />
      )}
      <AnimatePresence>
        {builderSelected && !buildMode && (
          <BuilderCommandPanel
            onBuildNest={() => setBuildMode(true)}
            onClose={() => setSelection(null)}
          />
        )}
      </AnimatePresence>
      <PlaceNestDialog
        open={pendingPlacement !== null}
        mapX={pendingPlacement?.x ?? 0}
        mapY={pendingPlacement?.y ?? 0}
        onClose={() => setPendingPlacement(null)}
        onCreated={(mapX, mapY) => startWalk({ x: mapX, y: mapY }, "build")}
      />
    </>
  );
}
