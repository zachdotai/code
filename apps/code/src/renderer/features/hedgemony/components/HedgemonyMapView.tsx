import { PointerSensor } from "@dnd-kit/dom";
import type { DragDropEvents } from "@dnd-kit/react";
import { DragDropProvider } from "@dnd-kit/react";
import type { Hoglet, Nest } from "@main/services/hedgemony/schemas";
import { trpcClient } from "@renderer/trpc/client";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { playSfx } from "../audio/sfx";
import { playVoice } from "../audio/voice";
import { useBuilderCoordinator } from "../hooks/useBuilderCoordinator";
import { useSignalIngestion } from "../hooks/useSignalIngestion";
import { initializeNestStore } from "../service/nestSubscriptionService";
import {
  type BookmarkSlot,
  useHedgemonyViewStore,
} from "../stores/hedgemonyViewStore";
import {
  SIGNAL_STAGING_BUCKET,
  useHogletStore,
  WILD_BUCKET,
} from "../stores/hogletStore";
import { selectNests, useNestStore } from "../stores/nestStore";
import { useSpawnDialogStore } from "../stores/spawnDialogStore";
import { BuilderCommandPanel } from "./BuilderCommandPanel";
import { HedgehouseCommandPanel } from "./HedgehouseCommandPanel";
import { HedgemonyHoldingPanel } from "./HedgemonyHoldingPanel";
import { HedgemonyMapSurface, type MoveMarker } from "./HedgemonyMapSurface";
import { NestBroodCluster } from "./NestBroodCluster";
import { NestDetailPanel } from "./NestDetailPanel";
import { type NestCreationMode, PlaceNestDialog } from "./PlaceNestDialog";
import { SpawnHogletPanel } from "./SpawnHogletPanel";
import { WildHogletFlock } from "./WildHogletFlock";

const log = logger.scope("hedgemony-map-view");

type Selection =
  | { type: "nest"; id: string }
  | { type: "builder" }
  | { type: "hedgehouse" }
  | null;

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
  const openSpawnHoglet = useSpawnDialogStore((s) => s.openSpawnHoglet);
  const closeSpawnHoglet = useSpawnDialogStore((s) => s.closeSpawnHoglet);
  const fullscreen = useHedgemonyViewStore((s) => s.fullscreen);
  const setFullscreen = useHedgemonyViewStore((s) => s.setFullscreen);
  const setOsFullscreen = useHedgemonyViewStore((s) => s.setOsFullscreen);
  const setView = useHedgemonyViewStore((s) => s.setView);
  const saveBookmark = useHedgemonyViewStore((s) => s.saveBookmark);

  const builder = useBuilderCoordinator({
    nests,
    onPendingBuildCommit: (nest) => useNestStore.getState().upsert(nest),
  });

  // Mirrors Signals Inbox reports into Hedgemony as signal-backed hoglets
  // while the map view is mounted. Tears down with the view.
  useSignalIngestion();

  useEffect(() => {
    return initializeNestStore();
  }, []);

  // Keep the store flag in sync with the DOM's actual fullscreen state — the
  // OS may exit fullscreen via its own controls (Esc from the browser, the
  // window's traffic-light, etc.) without us hearing about it otherwise.
  useEffect(() => {
    const handler = () => {
      setOsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, [setOsFullscreen]);

  // Always tear down OS fullscreen when the map unmounts so we don't strand
  // the user in fullscreen on another view.
  useEffect(() => {
    return () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  const exitOsFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // Ignore — fullscreenchange listener will reconcile the store.
      }
    }
  }, []);

  const enterFullscreen = useCallback(() => {
    setFullscreen(true);
  }, [setFullscreen]);

  const exitFullscreen = useCallback(() => {
    setFullscreen(false);
    void exitOsFullscreen();
  }, [setFullscreen, exitOsFullscreen]);

  const toggleFullscreen = useCallback(() => {
    if (fullscreen) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }, [fullscreen, enterFullscreen, exitFullscreen]);

  const toggleOsFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await exitOsFullscreen();
      return;
    }
    // Enter the in-app overlay too so chrome is hidden underneath.
    if (!fullscreen) setFullscreen(true);
    try {
      await document.documentElement.requestFullscreen();
    } catch (error) {
      log.warn("Failed to enter OS fullscreen", { error });
    }
  }, [exitOsFullscreen, fullscreen, setFullscreen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Esc unwinds the most-specific UI mode first: placement → fullscreen →
      // selection. Without this ordering, hitting Esc in fullscreen during a
      // placement would dump the user all the way back to nothing-selected.
      if (mode.kind !== "browsing") {
        setMode({ kind: "browsing" });
        return;
      }
      if (fullscreen) {
        exitFullscreen();
        return;
      }
      if (selection) setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, selection, fullscreen, exitFullscreen]);

  // Suppress map-only hotkeys while a modal dialog is open so typing in the
  // dialog (or just having it focused) doesn't ricochet into fullscreen /
  // bookmark recall.
  const dialogOpen = pendingPlacement !== null || spawnHogletOpen;
  const mapHotkeyOptions = {
    enableOnFormTags: false,
    preventDefault: true,
    enabled: !dialogOpen,
  } as const;

  useHotkeys("f", toggleFullscreen, mapHotkeyOptions);
  useHotkeys("shift+f, f11", toggleOsFullscreen, mapHotkeyOptions);

  const recallBookmark = useCallback(
    (slot: BookmarkSlot) => {
      const bookmark = useHedgemonyViewStore.getState().bookmarks[slot];
      if (!bookmark) {
        toast(`No view saved in slot ${slot}`, {
          description: `Press Shift+${slot} on the map to save this view.`,
        });
        return;
      }
      setView(bookmark.panX, bookmark.panY, bookmark.zoom);
    },
    [setView],
  );

  const handleSaveBookmark = useCallback(
    (slot: BookmarkSlot) => {
      saveBookmark(slot);
      toast(`Saved view ${slot}`, {
        description: `Press ${slot} to jump back.`,
      });
    },
    [saveBookmark],
  );

  useHotkeys("1", () => recallBookmark(1), mapHotkeyOptions, [recallBookmark]);
  useHotkeys("2", () => recallBookmark(2), mapHotkeyOptions, [recallBookmark]);
  useHotkeys("3", () => recallBookmark(3), mapHotkeyOptions, [recallBookmark]);
  useHotkeys("shift+1", () => handleSaveBookmark(1), mapHotkeyOptions, [
    handleSaveBookmark,
  ]);
  useHotkeys("shift+2", () => handleSaveBookmark(2), mapHotkeyOptions, [
    handleSaveBookmark,
  ]);
  useHotkeys("shift+3", () => handleSaveBookmark(3), mapHotkeyOptions, [
    handleSaveBookmark,
  ]);

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
  const hedgehouseSelected = selection?.type === "hedgehouse";
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
          sourceBucket?: "wild" | "signal_staging";
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
    const { hogletId, sourceNestId = null, sourceBucket } = source;

    if (target?.type === "nest" && target.nestId) {
      if (sourceNestId !== null) {
        toast.error("Release this hoglet to wild before adopting it elsewhere");
        return;
      }
      const adoptedFrom: "wild" | "signal" =
        sourceBucket === "signal_staging" ? "signal" : "wild";
      void adoptHoglet(hogletId, target.nestId, sourceBucket, adoptedFrom);
    } else if (target?.type === "wild") {
      if (sourceNestId === null) {
        // Signal-staging → wild and wild → wild are no-ops; the bucket is
        // determined by the hoglet's signalReportId, not by operator choice.
        if (sourceBucket === "signal_staging") {
          toast.error(
            "Signal hoglets can't move to wild — drop on a nest or use Dismiss",
          );
        }
        return;
      }
      void releaseHoglet(hogletId, sourceNestId);
    } else if (target?.type === "signal_staging") {
      if (sourceNestId === null) {
        // Already in staging (or wild). Wild → staging is rejected: the bucket
        // belongs to the signal-report linkage.
        if (sourceBucket === "wild") {
          toast.error("Wild hoglets can't become signal-staged");
        }
        return;
      }
      void releaseHoglet(hogletId, sourceNestId);
    }
  }, []);

  // The map + every floating panel that should appear on top of it. In
  // fullscreen, this entire bundle is portalled to document.body so the
  // panels (which use position: fixed) sit above the z-[1000] overlay rather
  // than getting hidden behind it. The outer `relative` wrapper anchors the
  // absolutely-positioned panels (NestDetailPanel, SpawnHogletPanel, etc.)
  // to the map area so they don't bleed onto the app sidebar.
  const mapContent = (
    <div className="relative h-full w-full">
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
        onToggleFullscreen={toggleFullscreen}
        hedgehouseSelected={hedgehouseSelected}
        onHedgehouseSelect={() => {
          playSfx("select");
          playVoice("hoglet:select");
          setSelection({ type: "hedgehouse" });
        }}
      >
        {nests.map((nest) => (
          <NestBroodCluster key={nest.id} nest={nest} />
        ))}
        <WildHogletFlock />
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
      <AnimatePresence>
        {hedgehouseSelected && !spawnHogletOpen && (
          <HedgehouseCommandPanel
            onSpawnWildHog={openSpawnHoglet}
            onClose={() => setSelection(null)}
          />
        )}
      </AnimatePresence>
      <HedgemonyHoldingPanel />
      <AnimatePresence>
        {spawnHogletOpen && (
          <SpawnHogletPanel
            onClose={() => {
              closeSpawnHoglet();
              if (selection?.type === "hedgehouse") setSelection(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );

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
      {fullscreen ? (
        createPortal(
          <motion.div
            key="hedgemony-fullscreen"
            className="fixed inset-0 z-[1000] bg-(--gray-1)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {mapContent}
            <div className="-translate-x-1/2 pointer-events-none absolute bottom-3 left-1/2 rounded-(--radius-2) border border-(--gray-6) bg-(--gray-2)/85 px-3 py-1 text-(--gray-11) text-[11px] backdrop-blur-sm">
              F · fullscreen &nbsp;·&nbsp; Shift+F · OS &nbsp;·&nbsp; 1/2/3
              recall &nbsp;·&nbsp; Shift+1/2/3 save &nbsp;·&nbsp; Esc exit
            </div>
            <FullscreenVignette />
          </motion.div>,
          document.body,
        )
      ) : (
        <div className="relative h-full w-full">{mapContent}</div>
      )}
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
    </DragDropProvider>
  );
}

function FullscreenVignette() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.18) 92%, rgba(0,0,0,0.34) 100%)",
      }}
    />
  );
}

async function adoptHoglet(
  hogletId: string,
  nestId: string,
  sourceBucket: "wild" | "signal_staging" | undefined,
  trackSource: "wild" | "signal",
): Promise<void> {
  const bucketKey =
    sourceBucket === "signal_staging" ? SIGNAL_STAGING_BUCKET : WILD_BUCKET;
  const store = useHogletStore.getState();
  const original = store.byBucket[bucketKey]?.find((h) => h.id === hogletId);
  if (!original) {
    log.warn("Adopt: source hoglet not found in source bucket", {
      hogletId,
      bucketKey,
    });
    return;
  }

  // Optimistic move: source bucket → nest bucket.
  const optimistic: Hoglet = {
    ...original,
    nestId,
    updatedAt: new Date().toISOString(),
  };
  store.remove(bucketKey, hogletId);
  store.upsert(nestId, optimistic);

  try {
    const updated = await trpcClient.hedgemony.hoglets.adopt.mutate({
      hogletId,
      nestId,
    });
    useHogletStore.getState().upsert(nestId, updated);
    track(ANALYTICS_EVENTS.HEDGEMONY_HOGLET_ADOPTED, { source: trackSource });
  } catch (error) {
    log.error("Failed to adopt hoglet", { hogletId, nestId, error });
    const current = useHogletStore.getState();
    current.remove(nestId, hogletId);
    current.upsert(bucketKey, original);
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

  // Destination bucket is determined by signalReportId — signal-backed
  // hoglets return to staging, ad-hoc ones return to wild. This matches the
  // server-side routing in HogletService.release.
  const destinationBucket =
    original.signalReportId !== null ? SIGNAL_STAGING_BUCKET : WILD_BUCKET;
  const optimistic: Hoglet = {
    ...original,
    nestId: null,
    updatedAt: new Date().toISOString(),
  };
  store.remove(sourceNestId, hogletId);
  store.upsert(destinationBucket, optimistic);

  try {
    const updated = await trpcClient.hedgemony.hoglets.release.mutate({
      hogletId,
    });
    useHogletStore.getState().upsert(destinationBucket, updated);
    track(ANALYTICS_EVENTS.HEDGEMONY_HOGLET_RELEASED, { source: "nest" });
  } catch (error) {
    log.error("Failed to release hoglet", {
      hogletId,
      sourceNestId,
      error,
    });
    const current = useHogletStore.getState();
    current.remove(destinationBucket, hogletId);
    current.upsert(sourceNestId, original);
    toast.error("Could not release hoglet");
  }
}
