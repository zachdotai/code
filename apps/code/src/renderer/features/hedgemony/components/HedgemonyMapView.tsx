import { PointerSensor } from "@dnd-kit/dom";
import type { DragDropEvents } from "@dnd-kit/react";
import { DragDropProvider } from "@dnd-kit/react";
import { genderForName } from "@main/services/hedgemony/hoglet-names";
import { logger } from "@utils/logger";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { useBgmStore } from "../audio/bgmStore";
import { playSfx } from "../audio/sfx";
import { useSfxStore } from "../audio/sfxStore";
import { playVoice } from "../audio/voice";
import { HEDGEMONY_CONFIG } from "../config";
import type { HedgemonyHotkeyContext } from "../constants/hotkeys";
import {
  BUILDER_NAME,
  HEDGEHOUSE_MAP_X,
  HEDGEHOUSE_MAP_Y,
} from "../constants/map";
import { useBuilderCoordinator } from "../hooks/useBuilderCoordinator";
import { useSignalIngestion } from "../hooks/useSignalIngestion";
import {
  type HogletDragSource,
  type HogletDragTarget,
  handleHogletDrop,
} from "../service/hogletMutations";
import { initializeWildHogletStore } from "../service/hogletSubscriptionService";
import { moveNest } from "../service/nestMutations";
import { initializeNestStore } from "../service/nestSubscriptionService";
import { initializePrGraphForNest } from "../service/prGraphSubscriptionService";
import {
  computeMapClickAction,
  type ViewMode,
} from "../state/computeMapClickAction";
import {
  type ControlGroupSelection,
  type ControlGroupSlot,
  useControlGroupStore,
} from "../stores/controlGroupStore";
import { useHedgemonySelectionStore } from "../stores/hedgemonySelectionStore";
import {
  type BookmarkSlot,
  useHedgemonyViewStore,
} from "../stores/hedgemonyViewStore";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { selectHogletById, useHogletStore } from "../stores/hogletStore";
import { selectNests, useNestStore } from "../stores/nestStore";
import { useSpawnDialogStore } from "../stores/spawnDialogStore";
import { collectHogletWorldPositions } from "../utils/hogletPositions";
import { applyHogletVisualPositions } from "../utils/hogletVisualPositions";
import { findPath, type Obstacle, type Vec2 } from "../utils/pathfinding";
import {
  BUILDER_OBSTACLE_RADIUS,
  HOGLET_RADIUS,
  hogletObstacles,
  worldObstacles,
} from "../utils/worldObstacles";
import { BuilderCommandPanel } from "./BuilderCommandPanel";
import type { BuilderSpriteHandle } from "./BuilderSprite";
import { DyingHogletLayer } from "./DyingHogletLayer";
import { DyingNestLayer } from "./DyingNestLayer";
import { FinOpsPanel } from "./FinOpsPanel";
import { HedgehouseCommandPanel } from "./HedgehouseCommandPanel";
import { HedgemonyHotkeyHelper } from "./HedgemonyHotkeyHelper";
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
  | { type: "money-hog" }
  | { type: "hoglets"; ids: string[]; includeBuilder?: boolean }
  | null;

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
  const moveMarkerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spawnHogletOpen = useSpawnDialogStore((s) => s.spawnHogletOpen);
  const openSpawnHoglet = useSpawnDialogStore((s) => s.openSpawnHoglet);
  const closeSpawnHoglet = useSpawnDialogStore((s) => s.closeSpawnHoglet);
  const fullscreen = useHedgemonyViewStore((s) => s.fullscreen);
  const setFullscreen = useHedgemonyViewStore((s) => s.setFullscreen);
  const setOsFullscreen = useHedgemonyViewStore((s) => s.setOsFullscreen);
  const setView = useHedgemonyViewStore((s) => s.setView);
  const saveBookmark = useHedgemonyViewStore((s) => s.saveBookmark);
  const toggleBgmMute = useBgmStore((s) => s.toggleMute);
  const toggleSfxMute = useSfxStore((s) => s.toggleMute);
  const [helperOpen, setHelperOpen] = useState(false);

  const builderSpriteRef = useRef<BuilderSpriteHandle | null>(null);
  const getBuilderPosition = useCallback((): Vec2 | null => {
    return builderSpriteRef.current?.getCurrentPosition() ?? null;
  }, []);
  // Resolve the builder's current pixel position via the imperative handle,
  // falling back to a fixed point only if the sprite hasn't mounted yet —
  // e.g. the very first render. Callers feed this into `builder.startWalk`'s
  // `from` arg and into obstacle/hit-test calculations.
  const builderPosOrFallback = useCallback((): Vec2 => {
    return getBuilderPosition() ?? { x: 0, y: 160 };
  }, [getBuilderPosition]);

  const builder = useBuilderCoordinator({
    nests,
    getCurrentPosition: getBuilderPosition,
    onPendingBuildCommit: (nest) => useNestStore.getState().upsert(nest),
  });

  // Mirrors Signals Inbox reports into Hedgemony as signal-backed hoglets
  // while the map view is mounted. Tears down with the view.
  useSignalIngestion();

  // Subscribe to the wild bucket while the map is mounted. Both ad-hoc
  // operator spawns and unrouted signal-backed hoglets live here, and the
  // wild flock renders directly on the map.
  useEffect(() => {
    return initializeWildHogletStore();
  }, []);

  useEffect(() => {
    return initializeNestStore();
  }, []);

  useEffect(() => {
    return () => {
      if (moveMarkerTimerRef.current) {
        clearTimeout(moveMarkerTimerRef.current);
      }
    };
  }, []);

  // Mirror the hoglet portion of the local selection out to a small global
  // store so the sidebar's task list can highlight tasks linked to selected
  // hoglets. Clearing on unmount keeps the sidebar in sync when the map view
  // tears down (e.g. user navigates away from the command center).
  useEffect(() => {
    const ids = selection?.type === "hoglets" ? selection.ids : [];
    useHedgemonySelectionStore.getState().setSelectedHogletIds(ids);
  }, [selection]);

  useEffect(() => {
    return () => {
      useHedgemonySelectionStore.getState().clear();
    };
  }, []);

  // Slice 8 — bootstrap a PR-graph edge subscription per nest. Each nest
  // disposer is keyed by id in a ref so we open/close incrementally when nests
  // are added/removed, rather than tearing down every subscription whenever
  // the `nests` array reshuffles (e.g. on status updates that mutate the
  // record but keep the same membership).
  const prGraphDisposersRef = useRef<Map<string, () => void>>(new Map());
  const nestIdsKey = useMemo(() => nests.map((n) => n.id).join(","), [nests]);
  useEffect(() => {
    const disposers = prGraphDisposersRef.current;
    const liveIds = new Set(nestIdsKey ? nestIdsKey.split(",") : []);
    for (const id of liveIds) {
      if (!disposers.has(id)) {
        disposers.set(id, initializePrGraphForNest(id));
      }
    }
    for (const [id, dispose] of disposers) {
      if (!liveIds.has(id)) {
        dispose();
        disposers.delete(id);
      }
    }
  }, [nestIdsKey]);

  // Tear down all PR-graph subscriptions when the map view unmounts.
  useEffect(() => {
    const disposers = prGraphDisposersRef.current;
    return () => {
      for (const dispose of disposers.values()) dispose();
      disposers.clear();
    };
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
      // The hotkey helper handles its own Esc; let it close on its own without
      // also unwinding the player's placement / selection state behind it.
      if (helperOpen) return;
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
  }, [mode, selection, fullscreen, exitFullscreen, helperOpen]);

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
        description: `Press F${4 + slot} to jump back.`,
      });
    },
    [saveBookmark],
  );

  // Camera bookmarks live on F5..F7 so the bare digit keys are free for
  // SC-style control groups. F-keys read as "view" anyway (next to F11 for
  // fullscreen).
  useHotkeys("f5", () => recallBookmark(1), mapHotkeyOptions, [recallBookmark]);
  useHotkeys("f6", () => recallBookmark(2), mapHotkeyOptions, [recallBookmark]);
  useHotkeys("f7", () => recallBookmark(3), mapHotkeyOptions, [recallBookmark]);
  useHotkeys("shift+f5", () => handleSaveBookmark(1), mapHotkeyOptions, [
    handleSaveBookmark,
  ]);
  useHotkeys("shift+f6", () => handleSaveBookmark(2), mapHotkeyOptions, [
    handleSaveBookmark,
  ]);
  useHotkeys("shift+f7", () => handleSaveBookmark(3), mapHotkeyOptions, [
    handleSaveBookmark,
  ]);

  // AoE-style camera commands. Surface owns the imperative animations; we
  // route through its handle so the keys behave identically to the on-screen
  // Fit / Center / Reset buttons.
  useHotkeys("z", () => surfaceRef.current?.fitToContents(), mapHotkeyOptions);
  useHotkeys(
    "shift+z",
    () => surfaceRef.current?.resetView(),
    mapHotkeyOptions,
  );
  useHotkeys(
    "space",
    () => surfaceRef.current?.centerSelected(),
    mapHotkeyOptions,
  );

  // Audio. Plain `m` is far enough from any other binding to be safe; Shift+M
  // toggles the louder voice/SFX bucket. Stays enabled in dialogs so players
  // can silence the hedgehog from anywhere.
  useHotkeys("m", () => toggleBgmMute(), { preventDefault: true }, [
    toggleBgmMute,
  ]);
  useHotkeys("shift+m", () => toggleSfxMute(), { preventDefault: true }, [
    toggleSfxMute,
  ]);

  const voiceGenderForHoglet = useCallback((hogletId: string) => {
    const hoglet = selectHogletById(hogletId)(useHogletStore.getState());
    return genderForName(hoglet?.name ?? null);
  }, []);

  // RTS-style keyboard selection. Without this the map has no way to pick a
  // unit without a mouse. F1/F2 grab the two fixed-position structures; F3
  // cycles nests since they're a dynamic set. Each selection also pans the
  // camera so the player can see what they grabbed.
  const selectBuilder = useCallback(() => {
    playSfx("select");
    playVoice("builder:select", genderForName(BUILDER_NAME));
    setSelection({ type: "builder" });
    const pos = builderPosOrFallback();
    surfaceRef.current?.centerOnPoint(pos.x, pos.y);
  }, [builderPosOrFallback]);
  useHotkeys("f1", selectBuilder, mapHotkeyOptions, [selectBuilder]);

  const selectHedgehouse = useCallback(() => {
    playSfx("select");
    setSelection({ type: "hedgehouse" });
    surfaceRef.current?.centerOnPoint(HEDGEHOUSE_MAP_X, HEDGEHOUSE_MAP_Y);
  }, []);
  useHotkeys("f2", selectHedgehouse, mapHotkeyOptions, [selectHedgehouse]);

  const cycleNest = useCallback(
    (direction: 1 | -1) => {
      if (nests.length === 0) return;
      const currentId = selection?.type === "nest" ? selection.id : null;
      const currentIdx = currentId
        ? nests.findIndex((n) => n.id === currentId)
        : -1;
      // Wrap forward and backward; with nothing selected we start at the
      // first nest going forward, the last going backward.
      const nextIdx =
        currentIdx === -1
          ? direction === 1
            ? 0
            : nests.length - 1
          : (currentIdx + direction + nests.length) % nests.length;
      const nest = nests[nextIdx];
      playSfx("select");
      playVoice("hedgehog:select");
      setSelection({ type: "nest", id: nest.id });
      surfaceRef.current?.centerOnPoint(nest.mapX, nest.mapY);
    },
    [nests, selection],
  );
  useHotkeys("f3", () => cycleNest(1), mapHotkeyOptions, [cycleNest]);
  useHotkeys("shift+f3", () => cycleNest(-1), mapHotkeyOptions, [cycleNest]);

  // SC-style control groups: Mod+Shift+N saves the current selection into
  // slot N; bare N recalls it. Hoglet IDs are filtered against the live
  // store on recall so retired hoglets drop out instead of resurrecting.
  const assignControlGroup = useControlGroupStore((s) => s.assign);
  const handleAssignControlGroup = useCallback(
    (slot: ControlGroupSlot) => {
      if (!selection || selection.type === "money-hog") {
        toast(`Nothing selected for group ${slot}`, {
          description: "Select a unit or nest first, then assign.",
        });
        return;
      }
      const snapshot: ControlGroupSelection =
        selection.type === "hoglets"
          ? {
              type: "hoglets",
              ids: [...selection.ids],
              includeBuilder: selection.includeBuilder,
            }
          : selection;
      assignControlGroup(slot, snapshot);
      playSfx("select");
      toast(`Saved control group ${slot}`, {
        description: `Press ${slot} to recall.`,
      });
    },
    [selection, assignControlGroup],
  );

  const recallControlGroup = useCallback(
    (slot: ControlGroupSlot) => {
      const saved = useControlGroupStore.getState().groups[slot];
      if (!saved) {
        toast(`No group ${slot} saved`, {
          description: `Select something and press Mod+Shift+${slot} to save.`,
        });
        return;
      }

      // Filter stale hoglet refs against the live store so retiring a hoglet
      // doesn't break the group. Empty after filtering = the group decayed.
      let recalled: Selection = saved;
      let centerPoint: { x: number; y: number } | null = null;
      if (saved.type === "hoglets") {
        const byBucket = useHogletStore.getState().byBucket;
        const liveIds = new Set<string>();
        for (const bucket of Object.values(byBucket)) {
          for (const h of bucket) liveIds.add(h.id);
        }
        const aliveIds = saved.ids.filter((id) => liveIds.has(id));
        if (aliveIds.length === 0 && !saved.includeBuilder) {
          toast(`Group ${slot} is empty`, {
            description: "All members were retired.",
          });
          return;
        }
        recalled = {
          type: "hoglets",
          ids: aliveIds,
          includeBuilder: saved.includeBuilder,
        };
        if (aliveIds.length > 0) {
          const positions = collectHogletWorldPositions(
            nests,
            byBucket,
            useHogletPositionStore.getState().positions,
          );
          const alivePositions = positions.filter((p) =>
            aliveIds.includes(p.hogletId),
          );
          if (alivePositions.length > 0) {
            const sumX = alivePositions.reduce((s, p) => s + p.x, 0);
            const sumY = alivePositions.reduce((s, p) => s + p.y, 0);
            centerPoint = {
              x: sumX / alivePositions.length,
              y: sumY / alivePositions.length,
            };
          }
        }
        if (!centerPoint && saved.includeBuilder) {
          centerPoint = builderPosOrFallback();
        }
      } else if (saved.type === "nest") {
        const nest = nests.find((n) => n.id === saved.id);
        if (!nest) {
          toast(`Group ${slot} is empty`, {
            description: "The saved nest was archived.",
          });
          return;
        }
        centerPoint = { x: nest.mapX, y: nest.mapY };
      } else if (saved.type === "builder") {
        centerPoint = builderPosOrFallback();
      } else if (saved.type === "hedgehouse") {
        centerPoint = { x: HEDGEHOUSE_MAP_X, y: HEDGEHOUSE_MAP_Y };
      }

      playSfx("select");
      if (recalled?.type === "hoglets" && recalled.ids.length > 0) {
        playVoice("hoglet:select", voiceGenderForHoglet(recalled.ids[0]));
      } else if (recalled?.type === "builder") {
        playVoice("builder:select", genderForName(BUILDER_NAME));
      } else if (recalled?.type === "nest") {
        playVoice("hedgehog:select");
      }
      setSelection(recalled);
      if (centerPoint) {
        surfaceRef.current?.centerOnPoint(centerPoint.x, centerPoint.y);
      }
    },
    [nests, builderPosOrFallback, voiceGenderForHoglet],
  );

  // useHotkeys can't be invoked in a loop, so unroll the nine slots. Each
  // pair shares the same options object as the other map hotkeys (disabled
  // in dialogs, not in form fields).
  useHotkeys("1", () => recallControlGroup(1), mapHotkeyOptions, [
    recallControlGroup,
  ]);
  useHotkeys("2", () => recallControlGroup(2), mapHotkeyOptions, [
    recallControlGroup,
  ]);
  useHotkeys("3", () => recallControlGroup(3), mapHotkeyOptions, [
    recallControlGroup,
  ]);
  useHotkeys("4", () => recallControlGroup(4), mapHotkeyOptions, [
    recallControlGroup,
  ]);
  useHotkeys("5", () => recallControlGroup(5), mapHotkeyOptions, [
    recallControlGroup,
  ]);
  useHotkeys("6", () => recallControlGroup(6), mapHotkeyOptions, [
    recallControlGroup,
  ]);
  useHotkeys("7", () => recallControlGroup(7), mapHotkeyOptions, [
    recallControlGroup,
  ]);
  useHotkeys("8", () => recallControlGroup(8), mapHotkeyOptions, [
    recallControlGroup,
  ]);
  useHotkeys("9", () => recallControlGroup(9), mapHotkeyOptions, [
    recallControlGroup,
  ]);
  useHotkeys(
    "mod+shift+1",
    () => handleAssignControlGroup(1),
    mapHotkeyOptions,
    [handleAssignControlGroup],
  );
  useHotkeys(
    "mod+shift+2",
    () => handleAssignControlGroup(2),
    mapHotkeyOptions,
    [handleAssignControlGroup],
  );
  useHotkeys(
    "mod+shift+3",
    () => handleAssignControlGroup(3),
    mapHotkeyOptions,
    [handleAssignControlGroup],
  );
  useHotkeys(
    "mod+shift+4",
    () => handleAssignControlGroup(4),
    mapHotkeyOptions,
    [handleAssignControlGroup],
  );
  useHotkeys(
    "mod+shift+5",
    () => handleAssignControlGroup(5),
    mapHotkeyOptions,
    [handleAssignControlGroup],
  );
  useHotkeys(
    "mod+shift+6",
    () => handleAssignControlGroup(6),
    mapHotkeyOptions,
    [handleAssignControlGroup],
  );
  useHotkeys(
    "mod+shift+7",
    () => handleAssignControlGroup(7),
    mapHotkeyOptions,
    [handleAssignControlGroup],
  );
  useHotkeys(
    "mod+shift+8",
    () => handleAssignControlGroup(8),
    mapHotkeyOptions,
    [handleAssignControlGroup],
  );
  useHotkeys(
    "mod+shift+9",
    () => handleAssignControlGroup(9),
    mapHotkeyOptions,
    [handleAssignControlGroup],
  );
  const flashMoveMarker = useCallback((x: number, y: number) => {
    const id = Date.now();
    setMoveMarker({ id, x, y });
    if (moveMarkerTimerRef.current) {
      clearTimeout(moveMarkerTimerRef.current);
    }
    moveMarkerTimerRef.current = setTimeout(() => {
      moveMarkerTimerRef.current = null;
      setMoveMarker((current) => (current?.id === id ? null : current));
    }, HEDGEMONY_CONFIG.animation.moveMarkerMs);
  }, []);

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
    }: {
      excludeHogletIds?: ReadonlySet<string>;
      includeBuilder: boolean;
    }): Obstacle[] => {
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

  const handleMapClick = (x: number, y: number) => {
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
  };

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
    [builderPosOrFallback],
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
  const hogletBuckets = useHogletStore((s) => s.byBucket);

  // Selection-sync focus: when the user picks a nest, that nest's brood stays
  // bright and everything else dims; when they pick a hoglet, its parent nest
  // is highlighted alongside the hoglet so the relationship is obvious. A
  // `null` affiliation set means "no focus, render everything at full opacity".
  const { affiliatedNestIds, dimWildFlock } = useMemo(() => {
    if (selection?.type === "nest") {
      return {
        affiliatedNestIds: new Set<string>([
          selection.id,
        ]) as ReadonlySet<string>,
        dimWildFlock: true,
      };
    }
    if (selection?.type === "hoglets") {
      const parents = new Set<string>();
      let hasWildSelected = false;
      for (const id of selection.ids) {
        let nestIdForHoglet: string | null | undefined;
        for (const bucket of Object.values(hogletBuckets)) {
          const found = bucket.find((h) => h.id === id);
          if (found) {
            nestIdForHoglet = found.nestId;
            break;
          }
        }
        if (nestIdForHoglet === undefined) continue;
        if (nestIdForHoglet === null) hasWildSelected = true;
        else parents.add(nestIdForHoglet);
      }
      return {
        affiliatedNestIds: parents as ReadonlySet<string>,
        dimWildFlock: !hasWildSelected,
      };
    }
    return {
      affiliatedNestIds: null as ReadonlySet<string> | null,
      dimWildFlock: false,
    };
  }, [selection, hogletBuckets]);
  const buildMode = mode.kind === "placingNest";
  const relocatingNestId = mode.kind === "relocatingNest" ? mode.nestId : null;

  // Drives the highlighted section of the hotkey helper so the player can see
  // which contextual commands are currently bound based on what's selected.
  const activeHotkeyContext: HedgemonyHotkeyContext | null = (() => {
    if (spawnHogletOpen || pendingPlacement) return "dialog";
    if (activeNest) return "nest";
    if (builderSelected) return "builder";
    if (hedgehouseSelected) return "hedgehouse";
    if (singleSelectedHogletId) return "hoglet";
    return null;
  })();

  const handleHogletSelect = useCallback(
    (hogletId: string, additive: boolean) => {
      playSfx("select");
      playVoice("hoglet:select", voiceGenderForHoglet(hogletId));
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
    [voiceGenderForHoglet],
  );

  const beginBuildNest = () => {
    playVoice("builder:build_mode", genderForName(BUILDER_NAME));
    setMode({ kind: "placingNest", creationMode: "guided" });
    setSelection({ type: "builder" });
  };

  const beginQuickNest = () => {
    playVoice("builder:build_mode", genderForName(BUILDER_NAME));
    setMode({ kind: "placingNest", creationMode: "simple" });
    setSelection({ type: "builder" });
  };

  const beginRelocateNest = (id: string) => {
    setMode({ kind: "relocatingNest", nestId: id });
  };

  const handleDragEnd = useCallback<DragDropEvents["dragend"]>((event) => {
    if (event.canceled) return;
    const source = event.operation.source?.data as HogletDragSource | undefined;
    const target = event.operation.target?.data as HogletDragTarget | undefined;
    handleHogletDrop(source, target);
  }, []);

  // The map + every floating panel that should appear on top of it. In
  // fullscreen, this entire bundle is portalled to document.body so the
  // panels (which use position: fixed) sit above the z-1000 overlay rather
  // than getting hidden behind it. The outer `relative` wrapper anchors the
  // absolutely-positioned panels (NestDetailPanel, SpawnHogletPanel, etc.)
  // to the map area so they don't bleed onto the app sidebar.
  const mapContent = (
    <div className="relative h-full w-full">
      <HedgemonyMapSurface
        ref={surfaceRef}
        nests={nests}
        selectedNestId={activeNest?.id ?? null}
        affiliatedNestIds={affiliatedNestIds}
        relocatingNestId={relocatingNestId}
        builderPath={builder.path}
        builderPos={builder.pos}
        builderSpriteRef={builderSpriteRef}
        builderSelected={builderSelected}
        builderAnimation={builder.animation}
        pendingNest={builder.pendingNest}
        buildMode={buildMode}
        moveMarker={moveMarker}
        onMapClick={handleMapClick}
        onMapRightClick={handleMapRightClick}
        onMapBoxSelect={handleBoxSelect}
        onNestSelect={(nest) => {
          playSfx("select");
          playVoice("hedgehog:select");
          setSelection({ type: "nest", id: nest.id });
        }}
        onBuilderSelect={() => {
          playSfx("select");
          playVoice("builder:select", genderForName(BUILDER_NAME));
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
        moneyHogSelected={selection?.type === "money-hog"}
        onMoneyHogSelect={() => {
          playSfx("select");
          setSelection((prev) =>
            prev?.type === "money-hog" ? null : { type: "money-hog" },
          );
        }}
      >
        {nests.map((nest) => (
          <NestBroodCluster
            key={nest.id}
            nest={nest}
            selectedHogletIds={selectedHogletIds}
            dimmed={
              affiliatedNestIds != null && !affiliatedNestIds.has(nest.id)
            }
            onHogletSelect={handleHogletSelect}
          />
        ))}
        <WildHogletFlock
          selectedHogletIds={selectedHogletIds}
          dimmed={dimWildFlock}
          onHogletSelect={handleHogletSelect}
        />
        <DyingHogletLayer />
        <DyingNestLayer />
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
            onFocusHoglet={(hogletId) => {
              playSfx("select");
              playVoice("hoglet:select", voiceGenderForHoglet(hogletId));
              setSelection({ type: "hoglets", ids: [hogletId] });
              // Pan camera to the hoglet so it's visible behind the panel.
              const positions = collectLiveHogletPositions();
              const pos = positions.find((p) => p.hogletId === hogletId);
              if (pos) surfaceRef.current?.centerOnPoint(pos.x, pos.y);
            }}
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
        {selection?.type === "money-hog" && (
          <FinOpsPanel onClose={() => setSelection(null)} />
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
        {selection?.type === "hoglets" &&
          (selection.ids.length > 1 ||
            (selection.ids.length === 1 && selection.includeBuilder)) && (
            <MultiHogletDetailPanel
              key="multi-hoglet-panel"
              hogletIds={selection.ids}
              includeBuilder={selection.includeBuilder}
              onClose={() => setSelection(null)}
              onSelectOne={(id) => setSelection({ type: "hoglets", ids: [id] })}
            />
          )}
      </AnimatePresence>
      <HedgemonyHotkeyHelper
        open={helperOpen}
        onOpenChange={setHelperOpen}
        activeContext={activeHotkeyContext}
      />
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
      {/* Lives inside mapContent so it portals into the fullscreen overlay's
          z-1000 stacking context. Rendered outside, Radix Dialog's default
          z-index sits below the overlay and the modal is invisible in
          fullscreen. */}
      <PlaceNestDialog
        open={pendingPlacement !== null}
        mapX={pendingPlacement?.x ?? 0}
        mapY={pendingPlacement?.y ?? 0}
        initialMode={pendingPlacement?.creationMode ?? "guided"}
        onClose={() => setPendingPlacement(null)}
        onCreated={(created) => {
          playSfx("place");
          playVoice("builder:place_nest", genderForName(BUILDER_NAME));
          builder.startWalk(
            { x: created.mapX, y: created.mapY },
            builderPosOrFallback(),
            "build",
            created,
            unitObstacles({ includeBuilder: false }),
          );
        }}
      />
    </div>
  );

  return (
    <DragDropProvider
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
            className="no-drag fixed inset-0 z-1000 bg-(--gray-1)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {mapContent}
            {!activeHotkeyContext && (
              <button
                type="button"
                onClick={exitFullscreen}
                title="Exit fullscreen (Esc / F)"
                aria-label="Exit fullscreen"
                // Hidden whenever something is selected so it doesn't collide
                // with the detail panel's close / relocate buttons. Esc / F
                // still exits fullscreen from the keyboard.
                className="absolute top-3 right-16 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-(--gray-6) bg-(--gray-2)/80 text-(--gray-11) text-[16px] backdrop-blur-sm transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
              >
                ×
              </button>
            )}
            <FullscreenVignette />
          </motion.div>,
          document.body,
        )
      ) : (
        <div className="relative h-full w-full">{mapContent}</div>
      )}
    </DragDropProvider>
  );
}

function FullscreenVignette() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.18)_92%,rgba(0,0,0,0.34)_100%)]"
    />
  );
}
