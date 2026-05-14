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
import { playSfx } from "../audio/sfx";
import { playVoice } from "../audio/voice";
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
import { HedgemonyHoldingPanel } from "./HedgemonyHoldingPanel";
import { HedgemonyMapSurface, type MoveMarker } from "./HedgemonyMapSurface";
import { NestBroodCluster } from "./NestBroodCluster";
import { NestDetailPanel } from "./NestDetailPanel";
import { type NestCreationMode, PlaceNestDialog } from "./PlaceNestDialog";
import { SpawnHogletDialog } from "./SpawnHogletDialog";

const log = logger.scope("hedgemony-map-view");

type Selection = { type: "nest"; id: string } | { type: "builder" } | null;

/**
 * Top-level interaction modes for the map. At most one is active at a time;
 * collapsing the prior `buildMode`/`relocatingNestId`/`pendingMode` booleans
 * into a discriminated union so handlers switch once with exhaustive checks
 * instead of hand-rolling the same priority ladder. Selection lives outside
 * the mode — it persists across mode transitions.
 */
type ViewMode =
  | { kind: "browsing" }
  | { kind: "placingNest"; creationMode: NestCreationMode }
  | { kind: "relocatingNest"; nestId: string };

export function HedgemonyMapView() {
  const nests = useNestStore(selectNests);

  const [mode, setMode] = useState<ViewMode>({ kind: "browsing" });
  const [pendingPlacement, setPendingPlacement] = useState<{
    x: number;
    y: number;
    creationMode: NestCreationMode;
  } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
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
      if (mode.kind !== "browsing") {
        setMode({ kind: "browsing" });
        return;
      }
      if (selection) setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, selection]);

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
      playSfx("error");
    }
  }

  const handleMapClick = (x: number, y: number) => {
    switch (mode.kind) {
      case "relocatingNest": {
        const nest = nests.find((n) => n.id === mode.nestId);
        setMode({ kind: "browsing" });
        if (!nest) return;
        const targetX = Math.round(x);
        const targetY = Math.round(y);
        flashMoveMarker(targetX, targetY);
        playSfx("order");
        playVoice("hoglet:order_move");
        void moveNest(nest, targetX, targetY, { undoable: true });
        return;
      }
      case "placingNest": {
        const creationMode = mode.creationMode;
        setMode({ kind: "browsing" });
        setPendingPlacement({ x, y, creationMode });
        return;
      }
      case "browsing":
        setSelection(null);
        return;
    }
  };

  const handleMapRightClick = (x: number, y: number) => {
    if (mode.kind !== "browsing") {
      setMode({ kind: "browsing" });
      return;
    }
    if (!selection || selection.type === "nest") return;

    const targetX = Math.round(x);
    const targetY = Math.round(y);
    playSfx("order");
    playVoice("hoglet:order_move");
    const resolved = builder.startWalk({ x: targetX, y: targetY }, "idle");
    flashMoveMarker(Math.round(resolved.x), Math.round(resolved.y));
  };

  const activeNest =
    selection?.type === "nest"
      ? (nests.find((nest) => nest.id === selection.id) ?? null)
      : null;
  const builderSelected = selection?.type === "builder";
  const buildMode = mode.kind === "placingNest";
  const relocatingNestId = mode.kind === "relocatingNest" ? mode.nestId : null;

  const beginBuildNest = () => {
    setMode({ kind: "placingNest", creationMode: "guided" });
    setSelection({ type: "builder" });
  };

  const beginQuickNest = () => {
    setMode({ kind: "placingNest", creationMode: "simple" });
    setSelection({ type: "builder" });
  };

  const beginRelocateNest = (id: string) => {
    setMode({ kind: "relocatingNest", nestId: id });
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
        pendingNest={builder.pendingNest}
        buildMode={buildMode}
        moveMarker={moveMarker}
        onMapClick={handleMapClick}
        onMapRightClick={handleMapRightClick}
        onNestSelect={(nest) => {
          playSfx("select");
          playVoice("hoglet:select");
          setSelection({ type: "nest", id: nest.id });
        }}
        onBuilderSelect={() => {
          playSfx("select");
          playVoice("hoglet:select");
          setSelection({ type: "builder" });
        }}
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
            setMode({ kind: "browsing" });
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
        initialMode={pendingPlacement?.creationMode ?? "guided"}
        onClose={() => setPendingPlacement(null)}
        onCreated={(created) => {
          playSfx("place");
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
