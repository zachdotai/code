import { PointerSensor } from "@dnd-kit/dom";
import type { DragDropEvents } from "@dnd-kit/react";
import { DragDropProvider } from "@dnd-kit/react";
import type { Hoglet, Nest } from "@main/services/hedgemony/schemas";
import { trpcClient } from "@renderer/trpc/client";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useBuilderCoordinator } from "../hooks/useBuilderCoordinator";
import { useHedgemonyViewStore } from "../stores/hedgemonyViewStore";
import { useHogletStore, WILD_BUCKET } from "../stores/hogletStore";
import {
  initializeNestStore,
  selectNests,
  useNestStore,
} from "../stores/nestStore";
import { useSpawnDialogStore } from "../stores/spawnDialogStore";
import { BuilderCommandPanel } from "./BuilderCommandPanel";
import { HedgemonyEmptyState } from "./HedgemonyEmptyState";
import { HedgemonyHoldingPanel } from "./HedgemonyHoldingPanel";
import { HedgemonyMapSurface, type MoveMarker } from "./HedgemonyMapSurface";
import { NestBroodCluster } from "./NestBroodCluster";
import { NestDetailPanel } from "./NestDetailPanel";
import { type NestCreationMode, PlaceNestDialog } from "./PlaceNestDialog";
import { SpawnHogletDialog } from "./SpawnHogletDialog";

const log = logger.scope("hedgemony-map-view");

type Selection = { type: "nest"; id: string } | { type: "builder" } | null;

export function HedgemonyMapView() {
  const nests = useNestStore(selectNests);
  const loaded = useNestStore((s) => s.loaded);

  const [pendingPlacement, setPendingPlacement] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [buildMode, setBuildMode] = useState(false);
  const [relocatingNestId, setRelocatingNestId] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<NestCreationMode>("guided");
  const [moveMarker, setMoveMarker] = useState<MoveMarker | null>(null);
  const spawnHogletOpen = useSpawnDialogStore((s) => s.spawnHogletOpen);
  const closeSpawnHoglet = useSpawnDialogStore((s) => s.closeSpawnHoglet);

  const builder = useBuilderCoordinator({
    nests,
    onPendingBuildCommit: (nest) => useNestStore.getState().upsert(nest),
  });

  useEffect(() => {
    return initializeNestStore();
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

    const resolved = builder.startWalk({ x: targetX, y: targetY }, "idle");
    flashMoveMarker(Math.round(resolved.x), Math.round(resolved.y));
  };

  const showEmptyState = loaded && nests.length === 0;
  const activeNest =
    selection?.type === "nest"
      ? (nests.find((nest) => nest.id === selection.id) ?? null)
      : null;
  const builderSelected = selection?.type === "builder";

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

  const handleDragStart = useCallback<DragDropEvents["dragstart"]>((event) => {
    const source = event.operation.source?.data;
    if (source?.type === "hoglet" && typeof source.sourceNestId === "string") {
      // Brood hoglet drag — make the release target visible if hidden.
      const view = useHedgemonyViewStore.getState();
      if (!view.holdingPanel.open) view.setHoldingPanelOpen(true);
      if (view.holdingPanel.collapsed) view.toggleHoldingPanelCollapsed();
    }
  }, []);

  const handleDragEnd = useCallback<DragDropEvents["dragend"]>((event) => {
    if (event.canceled) return;
    const source = event.operation.source?.data as
      | {
          type?: string;
          hogletId?: string;
          sourceNestId?: string | null;
        }
      | undefined;
    const target = event.operation.target?.data as
      | { type?: string; nestId?: string }
      | undefined;
    if (
      !source ||
      source.type !== "hoglet" ||
      typeof source.hogletId !== "string"
    ) {
      return;
    }
    const { hogletId, sourceNestId = null } = source;

    if (target?.type === "nest" && target.nestId) {
      if (sourceNestId !== null) {
        toast.error("Release this hoglet to wild before adopting it elsewhere");
        return;
      }
      void adoptHoglet(hogletId, target.nestId);
    } else if (target?.type === "wild") {
      if (sourceNestId === null) return;
      void releaseHoglet(hogletId, sourceNestId);
    }
  }, []);

  return (
    <DragDropProvider
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      sensors={[
        {
          plugin: PointerSensor,
          options: {
            activationConstraints: {
              distance: { value: 5 },
            },
          },
        },
      ]}
    >
      <HedgemonyMapSurface
        nests={nests}
        selectedNestId={activeNest?.id ?? null}
        relocatingNestId={relocatingNestId}
        builderPath={builder.path}
        builderPos={builder.pos}
        builderPositionRef={builder.visualPosRef}
        builderSelected={builderSelected}
        builderAnimation={builder.animation}
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
        onBuilderArrive={builder.handleArrive}
        onBuilderSegmentComplete={builder.handleSegmentComplete}
      >
        {nests.map((nest) => (
          <NestBroodCluster key={nest.id} nest={nest} />
        ))}
      </HedgemonyMapSurface>
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
        onCreated={(created) => {
          builder.startWalk(
            { x: created.mapX, y: created.mapY },
            "build",
            created,
          );
        }}
      />
      <HedgemonyHoldingPanel />
      <SpawnHogletDialog open={spawnHogletOpen} onClose={closeSpawnHoglet} />
    </DragDropProvider>
  );
}

async function adoptHoglet(hogletId: string, nestId: string): Promise<void> {
  const store = useHogletStore.getState();
  const original = store.byBucket[WILD_BUCKET]?.find((h) => h.id === hogletId);
  if (!original) {
    log.warn("Adopt: source hoglet not found in wild bucket", { hogletId });
    return;
  }

  // Optimistic move: wild → nest bucket.
  const optimistic: Hoglet = {
    ...original,
    nestId,
    updatedAt: new Date().toISOString(),
  };
  store.remove(WILD_BUCKET, hogletId);
  store.upsert(nestId, optimistic);

  try {
    const updated = await trpcClient.hedgemony.hoglets.adopt.mutate({
      hogletId,
      nestId,
    });
    useHogletStore.getState().upsert(nestId, updated);
    track(ANALYTICS_EVENTS.HEDGEMONY_HOGLET_ADOPTED, { source: "wild" });
  } catch (error) {
    log.error("Failed to adopt hoglet", { hogletId, nestId, error });
    const current = useHogletStore.getState();
    current.remove(nestId, hogletId);
    current.upsert(WILD_BUCKET, original);
    toast.error("Could not adopt hoglet");
  }
}

async function releaseHoglet(
  hogletId: string,
  sourceNestId: string,
): Promise<void> {
  const store = useHogletStore.getState();
  const original = store.byBucket[sourceNestId]?.find((h) => h.id === hogletId);
  if (!original) {
    log.warn("Release: source hoglet not found in nest bucket", {
      hogletId,
      sourceNestId,
    });
    return;
  }

  const optimistic: Hoglet = {
    ...original,
    nestId: null,
    updatedAt: new Date().toISOString(),
  };
  store.remove(sourceNestId, hogletId);
  store.upsert(WILD_BUCKET, optimistic);

  try {
    const updated = await trpcClient.hedgemony.hoglets.release.mutate({
      hogletId,
    });
    useHogletStore.getState().upsert(WILD_BUCKET, updated);
    track(ANALYTICS_EVENTS.HEDGEMONY_HOGLET_RELEASED, { source: "nest" });
  } catch (error) {
    log.error("Failed to release hoglet", {
      hogletId,
      sourceNestId,
      error,
    });
    const current = useHogletStore.getState();
    current.remove(WILD_BUCKET, hogletId);
    current.upsert(sourceNestId, original);
    toast.error("Could not release hoglet");
  }
}
