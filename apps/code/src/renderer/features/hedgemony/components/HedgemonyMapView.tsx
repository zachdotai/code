import { PointerSensor } from "@dnd-kit/dom";
import type { DragDropEvents } from "@dnd-kit/react";
import { DragDropProvider } from "@dnd-kit/react";
import { logger } from "@utils/logger";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { playSfx } from "../audio/sfx";
import { playVoice } from "../audio/voice";
import { useBuilderCoordinator } from "../hooks/useBuilderCoordinator";
import { useSignalIngestion } from "../hooks/useSignalIngestion";
import {
  type HogletDragSource,
  type HogletDragTarget,
  handleHogletDrop,
} from "../service/hogletMutations";
import { moveNest } from "../service/nestMutations";
import { initializeNestStore } from "../service/nestSubscriptionService";
import {
  type BookmarkSlot,
  useHedgemonyViewStore,
} from "../stores/hedgemonyViewStore";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { selectHogletById, useHogletStore } from "../stores/hogletStore";
import { selectNests, useNestStore } from "../stores/nestStore";
import { useSpawnDialogStore } from "../stores/spawnDialogStore";
import { collectHogletWorldPositions } from "../utils/hogletPositions";
import { BuilderCommandPanel } from "./BuilderCommandPanel";
import { HedgehouseCommandPanel } from "./HedgehouseCommandPanel";
import { HedgemonyHoldingPanel } from "./HedgemonyHoldingPanel";
import {
  HedgemonyMapSurface,
  type MapBoxSelection,
  type MapSurfaceHandle,
  type MoveMarker,
} from "./HedgemonyMapSurface";
import { HogletDetailPanel } from "./HogletDetailPanel";
import { MultiHogletDetailPanel } from "./MultiHogletDetailPanel";
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
  | { type: "hoglets"; ids: string[]; includeBuilder?: boolean }
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
  // window's traffic-light, etc.) without us hearing about it otherwise. When
  // the OS exits, also drop in-app fullscreen so the two stay coupled.
  useEffect(() => {
    const handler = () => {
      const isOs = Boolean(document.fullscreenElement);
      const wasOs = useHedgemonyViewStore.getState().osFullscreen;
      setOsFullscreen(isOs);
      if (wasOs && !isOs) {
        setFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, [setOsFullscreen, setFullscreen]);

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

  const enterFullscreen = useCallback(async () => {
    setFullscreen(true);
    // Always try OS fullscreen too: on macOS, in-app fullscreen still has the
    // OS-drawn traffic lights bleeding through the top-left of the map. OS
    // fullscreen is the only way to genuinely hide them and give the user a
    // Starcraft/AoE-style experience.
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (error) {
        log.warn("Failed to enter OS fullscreen", { error });
      }
    }
  }, [setFullscreen]);

  const exitFullscreen = useCallback(() => {
    setFullscreen(false);
    void exitOsFullscreen();
  }, [setFullscreen, exitOsFullscreen]);

  const toggleFullscreen = useCallback(() => {
    if (fullscreen) {
      exitFullscreen();
    } else {
      void enterFullscreen();
    }
  }, [fullscreen, enterFullscreen, exitFullscreen]);

  // Advanced toggle: in-app overlay only, no OS fullscreen. For users who
  // want to keep their menu bar / dock visible while still hiding app chrome.
  const toggleInAppFullscreen = useCallback(() => {
    if (fullscreen) {
      exitFullscreen();
    } else {
      setFullscreen(true);
    }
  }, [fullscreen, exitFullscreen, setFullscreen]);

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

  useHotkeys("f, f11", toggleFullscreen, mapHotkeyOptions);
  useHotkeys("shift+f", toggleInAppFullscreen, mapHotkeyOptions);

  const surfaceRef = useRef<MapSurfaceHandle | null>(null);

  const recallBookmark = useCallback(
    (slot: BookmarkSlot) => {
      const bookmark = useHedgemonyViewStore.getState().bookmarks[slot];
      if (!bookmark) {
        toast(`No view saved in slot ${slot}`, {
          description: `Press Shift+${slot} on the map to save this view.`,
        });
        return;
      }
      // Prefer the smooth-tween path via the surface; fall back to an
      // instant store update if the surface isn't mounted yet (e.g., during
      // unmount races).
      if (surfaceRef.current) {
        surfaceRef.current.animateToView(
          bookmark.panX,
          bookmark.panY,
          bookmark.zoom,
        );
      } else {
        setView(bookmark.panX, bookmark.panY, bookmark.zoom);
      }
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
        void moveNest(nest, targetX, targetY, {
          undoable: true,
          flashMoveMarker,
        });
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

    if (selection.type === "hoglets") {
      const positionStore = useHogletPositionStore.getState();
      // Multi-select formation: pack them in a small ring around the target so
      // they don't all stack on a single pixel. Single-select just snaps to
      // the exact click point.
      if (selection.ids.length === 1) {
        positionStore.setPosition(selection.ids[0], targetX, targetY);
      } else {
        const radius = 28 + selection.ids.length * 4;
        selection.ids.forEach((id, i) => {
          const angle = (2 * Math.PI * i) / selection.ids.length;
          positionStore.setPosition(
            id,
            targetX + Math.cos(angle) * radius,
            targetY + Math.sin(angle) * radius,
          );
        });
      }
      if (selection.includeBuilder) {
        builder.startWalk({ x: targetX, y: targetY }, "idle");
      }
      playSfx("order");
      playVoice("hoglet:order_move");
      flashMoveMarker(targetX, targetY);
      return;
    }

    playSfx("order");
    playVoice("hoglet:order_move");
    const resolved = builder.startWalk({ x: targetX, y: targetY }, "idle");
    flashMoveMarker(Math.round(resolved.x), Math.round(resolved.y));
  };

  const handleBoxSelect = useCallback(
    ({ minX, minY, maxX, maxY, additive }: MapBoxSelection) => {
      const nestsNow = selectNests(useNestStore.getState());
      const byBucket = useHogletStore.getState().byBucket;
      const overrides = useHogletPositionStore.getState().positions;
      const positions = collectHogletWorldPositions(
        nestsNow,
        byBucket,
        overrides,
      );
      const hit = positions
        .filter((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)
        .map((p) => p.hogletId);

      // Hit-test the builder at its live on-screen position so the marquee
      // catches him alongside any hoglets in the same drag.
      const builderPos = builder.visualPosRef.current;
      const builderInRect =
        builderPos.x >= minX &&
        builderPos.x <= maxX &&
        builderPos.y >= minY &&
        builderPos.y <= maxY;

      setSelection((prev) => {
        // Additive (shift/cmd) keeps a prior selection and unions in the
        // marquee hits. Non-additive replaces — clicking an empty area with
        // a tiny marquee that catches nothing still clears selection.
        if (additive) {
          const prevHoglets = prev?.type === "hoglets" ? prev.ids : [];
          const prevBuilder =
            prev?.type === "builder" ||
            (prev?.type === "hoglets" && prev.includeBuilder === true);
          const merged = Array.from(new Set([...prevHoglets, ...hit]));
          const withBuilder = prevBuilder || builderInRect;
          if (merged.length === 0) {
            return withBuilder ? { type: "builder" } : null;
          }
          return withBuilder
            ? { type: "hoglets", ids: merged, includeBuilder: true }
            : { type: "hoglets", ids: merged };
        }
        if (hit.length === 0) {
          return builderInRect ? { type: "builder" } : null;
        }
        return builderInRect
          ? { type: "hoglets", ids: hit, includeBuilder: true }
          : { type: "hoglets", ids: hit };
      });
      if (hit.length > 0 || builderInRect) playSfx("select");
    },
    [builder.visualPosRef],
  );

  const activeNest =
    selection?.type === "nest"
      ? (nests.find((nest) => nest.id === selection.id) ?? null)
      : null;
  const builderSelected =
    selection?.type === "builder" ||
    (selection?.type === "hoglets" && selection.includeBuilder === true);
  const hedgehouseSelected = selection?.type === "hedgehouse";
  const selectedHogletIds = useMemo(
    () => new Set<string>(selection?.type === "hoglets" ? selection.ids : []),
    [selection],
  );
  const singleSelectedHogletId =
    selection?.type === "hoglets" && selection.ids.length === 1
      ? selection.ids[0]
      : null;
  const activeHoglet = useHogletStore(selectHogletById(singleSelectedHogletId));
  const buildMode = mode.kind === "placingNest";
  const relocatingNestId = mode.kind === "relocatingNest" ? mode.nestId : null;

  const handleHogletSelect = useCallback(
    (hogletId: string, additive: boolean) => {
      playSfx("select");
      playVoice("hoglet:select");
      setSelection((prev) => {
        if (additive && prev?.type === "hoglets") {
          // Toggle: shift-clicking an already-selected hoglet removes it.
          if (prev.ids.includes(hogletId)) {
            const next = prev.ids.filter((id) => id !== hogletId);
            return next.length === 0 ? null : { type: "hoglets", ids: next };
          }
          return { type: "hoglets", ids: [...prev.ids, hogletId] };
        }
        return { type: "hoglets", ids: [hogletId] };
      });
    },
    [],
  );

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
    const source = event.operation.source?.data as HogletDragSource | undefined;
    const target = event.operation.target?.data as HogletDragTarget | undefined;
    handleHogletDrop(source, target);
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
        ref={surfaceRef}
        nests={nests}
        selectedNestId={activeNest?.id ?? null}
        relocatingNestId={relocatingNestId}
        builderPath={builder.path}
        builderPos={builder.pos}
        builderPositionRef={builder.visualPosRef}
        builderSelected={builderSelected}
        builderAnimation={builder.animation}
        hogletSelected={selectedHogletIds.size > 0}
        pendingNest={builder.pendingNest}
        buildMode={buildMode}
        moveMarker={moveMarker}
        onMapClick={handleMapClick}
        onMapRightClick={handleMapRightClick}
        onMapBoxSelect={handleBoxSelect}
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
          setSelection({ type: "hedgehouse" });
        }}
      >
        {nests.map((nest) => (
          <NestBroodCluster
            key={nest.id}
            nest={nest}
            selectedHogletIds={selectedHogletIds}
            onHogletSelect={handleHogletSelect}
          />
        ))}
        <WildHogletFlock
          selectedHogletIds={selectedHogletIds}
          onHogletSelect={handleHogletSelect}
        />
      </HedgemonyMapSurface>
      <AnimatePresence>
        {activeNest && (
          <NestDetailPanel
            key={activeNest.id}
            nest={activeNest}
            onClose={() => {
              setMode({ kind: "browsing" });
              setSelection(null);
            }}
            onRelocate={() => beginRelocateNest(activeNest.id)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {selection?.type === "builder" && !buildMode && (
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
      <AnimatePresence>
        {activeHoglet && (
          <HogletDetailPanel
            key={activeHoglet.id}
            hoglet={activeHoglet}
            onClose={() => setSelection(null)}
          />
        )}
        {selection?.type === "hoglets" && selection.ids.length > 1 && (
          <MultiHogletDetailPanel
            key="multi-hoglet-panel"
            hogletIds={selection.ids}
            onClose={() => setSelection(null)}
            onSelectOne={(id) => setSelection({ type: "hoglets", ids: [id] })}
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
            // `no-drag` is mandatory here: without it, even though the portal
            // visually covers the HeaderRow's `drag` region, the OS still
            // captures pointer events at the top of the screen for window
            // dragging, killing top-edge camera pan.
            className="no-drag fixed inset-0 z-[1000] bg-(--gray-1)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {mapContent}
            <button
              type="button"
              onClick={exitFullscreen}
              title="Exit fullscreen (Esc / F)"
              aria-label="Exit fullscreen"
              className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-(--gray-6) bg-(--gray-2)/80 text-(--gray-11) text-[16px] backdrop-blur-sm transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
            >
              ×
            </button>
            <BookmarkChips
              onRecall={recallBookmark}
              onSave={handleSaveBookmark}
            />
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

const BOOKMARK_SLOTS: BookmarkSlot[] = [1, 2, 3];

interface BookmarkChipsProps {
  onRecall: (slot: BookmarkSlot) => void;
  onSave: (slot: BookmarkSlot) => void;
}

function BookmarkChips({ onRecall, onSave }: BookmarkChipsProps) {
  // Subscribe at the slot level so we re-render when bookmarks change.
  const bookmarks = useHedgemonyViewStore((s) => s.bookmarks);
  return (
    <div className="-translate-x-1/2 absolute top-3 left-1/2 flex items-center gap-2">
      {BOOKMARK_SLOTS.map((slot) => {
        const saved = bookmarks[slot] !== undefined;
        return (
          <button
            key={slot}
            type="button"
            onClick={(event) =>
              event.shiftKey ? onSave(slot) : onRecall(slot)
            }
            title={
              saved
                ? `Recall view ${slot} (key ${slot}) · Shift-click to overwrite`
                : `No view in slot ${slot} · Shift-click to save current view`
            }
            className={`flex h-7 w-7 items-center justify-center rounded-(--radius-2) border text-[12px] tabular-nums backdrop-blur-sm transition-colors ${
              saved
                ? "border-(--accent-7) bg-(--accent-3)/85 font-semibold text-(--accent-11) hover:bg-(--accent-4)"
                : "border-(--gray-5) bg-(--gray-2)/70 text-(--gray-9) hover:bg-(--gray-3)"
            }`}
          >
            {slot}
          </button>
        );
      })}
    </div>
  );
}
