import { PointerSensor } from "@dnd-kit/dom";
import type { DragDropEvents } from "@dnd-kit/react";
import { DragDropProvider } from "@dnd-kit/react";
import { genderForName } from "@main/services/hedgemony/hoglet-names";
import { logger } from "@utils/logger";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { useCameraBookmarks } from "../hooks/useCameraBookmarks";
import { useHedgemonyHotkeys } from "../hooks/useHedgemonyHotkeys";
import { useHedgemonySubscriptions } from "../hooks/useHedgemonySubscriptions";
import { useSignalIngestion } from "../hooks/useSignalIngestion";
import {
  type HogletDragSource,
  type HogletDragTarget,
  handleHogletDrop,
} from "../service/hogletMutations";
import { moveNest } from "../service/nestMutations";
import {
  computeMapClickAction,
  type ViewMode,
} from "../state/computeMapClickAction";
import {
  applyBoxSelect as applyBoxSelectController,
  applyEscape,
  nextCycleNest,
  recallControlGroupSelection,
  type Selection,
  selectActiveHotkeyContext,
  selectAffiliation,
  snapshotSelectionForControlGroup,
  toggleHogletSelection,
} from "../state/HedgemonyController";
import {
  type ControlGroupSlot,
  useControlGroupStore,
} from "../stores/controlGroupStore";
import { useHedgemonySelectionStore } from "../stores/hedgemonySelectionStore";
import { useHedgemonyViewStore } from "../stores/hedgemonyViewStore";
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

  const nestIds = useMemo(() => nests.map((n) => n.id), [nests]);
  useHedgemonySubscriptions({ nestIds });

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
      const result = applyEscape({ mode, selection, fullscreen, helperOpen });
      if (!result.handled) return;
      if (result.exitFullscreen) {
        exitFullscreen();
        return;
      }
      if (result.mode !== mode) setMode(result.mode);
      if (result.selection !== selection) setSelection(result.selection);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, selection, fullscreen, exitFullscreen, helperOpen]);

  // Suppress map-only hotkeys while a modal dialog is open so typing in the
  // dialog (or just having it focused) doesn't ricochet into fullscreen /
  // bookmark recall.
  const dialogOpen = pendingPlacement !== null || spawnHogletOpen;

  const surfaceRef = useRef<MapSurfaceHandle | null>(null);

  const animateSurfaceToView = useCallback(
    (panX: number, panY: number, zoom: number) => {
      const surface = surfaceRef.current;
      if (!surface) return false;
      surface.animateToView(panX, panY, zoom);
      return true;
    },
    [],
  );

  const { saveBookmark: handleSaveBookmark, recallBookmark } =
    useCameraBookmarks({ animateToView: animateSurfaceToView });

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

  const selectHedgehouse = useCallback(() => {
    playSfx("select");
    setSelection({ type: "hedgehouse" });
    surfaceRef.current?.centerOnPoint(HEDGEHOUSE_MAP_X, HEDGEHOUSE_MAP_Y);
  }, []);

  const cycleNest = useCallback(
    (direction: 1 | -1) => {
      const result = nextCycleNest(selection, nests, direction);
      if (!result) return;
      playSfx("select");
      playVoice("hedgehog:select");
      setSelection(result.selection);
      surfaceRef.current?.centerOnPoint(result.centerOn.x, result.centerOn.y);
    },
    [nests, selection],
  );

  // SC-style control groups: Mod+Shift+N saves the current selection into
  // slot N; bare N recalls it. Hoglet IDs are filtered against the live
  // store on recall so retired hoglets drop out instead of resurrecting.
  const assignControlGroup = useControlGroupStore((s) => s.assign);
  const handleAssignControlGroup = useCallback(
    (slot: ControlGroupSlot) => {
      const result = snapshotSelectionForControlGroup(selection);
      if (result.kind === "nothing-selected") {
        toast(`Nothing selected for group ${slot}`, {
          description: "Select a unit or nest first, then assign.",
        });
        return;
      }
      assignControlGroup(slot, result.snapshot);
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
      const byBucket = useHogletStore.getState().byBucket;
      const liveHogletIds = new Set<string>();
      for (const bucket of Object.values(byBucket)) {
        for (const h of bucket) liveHogletIds.add(h.id);
      }
      const result = recallControlGroupSelection(
        saved,
        slot,
        liveHogletIds,
        nests,
      );
      if (result.kind === "not-saved") {
        toast(`No group ${slot} saved`, {
          description: `Select something and press Mod+Shift+${slot} to save.`,
        });
        return;
      }
      if (result.kind === "empty") {
        toast(`Group ${slot} is empty`, {
          description:
            result.reason === "decayed"
              ? "All members were retired."
              : "The saved nest was archived.",
        });
        return;
      }

      const recalled = result.selection;
      let centerPoint: { x: number; y: number } | null = null;
      if (recalled.type === "hoglets") {
        if (recalled.ids.length > 0) {
          const positions = collectHogletWorldPositions(
            nests,
            byBucket,
            useHogletPositionStore.getState().positions,
          );
          const alivePositions = positions.filter((p) =>
            recalled.ids.includes(p.hogletId),
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
        if (!centerPoint && recalled.includeBuilder) {
          centerPoint = builderPosOrFallback();
        }
      } else if (recalled.type === "nest") {
        const nest = nests.find((n) => n.id === recalled.id);
        if (nest) centerPoint = { x: nest.mapX, y: nest.mapY };
      } else if (recalled.type === "builder") {
        centerPoint = builderPosOrFallback();
      } else if (recalled.type === "hedgehouse") {
        centerPoint = { x: HEDGEHOUSE_MAP_X, y: HEDGEHOUSE_MAP_Y };
      }

      playSfx("select");
      if (result.voiceHogletId) {
        playVoice("hoglet:select", voiceGenderForHoglet(result.voiceHogletId));
      } else if (recalled.type === "builder") {
        playVoice("builder:select", genderForName(BUILDER_NAME));
      } else if (recalled.type === "nest") {
        playVoice("hedgehog:select");
      }
      setSelection(recalled);
      if (centerPoint) {
        surfaceRef.current?.centerOnPoint(centerPoint.x, centerPoint.y);
      }
    },
    [nests, builderPosOrFallback, voiceGenderForHoglet],
  );

  const fitToContents = useCallback(
    () => surfaceRef.current?.fitToContents(),
    [],
  );
  const resetView = useCallback(() => surfaceRef.current?.resetView(), []);
  const centerSelected = useCallback(
    () => surfaceRef.current?.centerSelected(),
    [],
  );

  useHedgemonyHotkeys(
    {
      onToggleFullscreen: toggleFullscreen,
      onToggleInAppFullscreen: toggleInAppFullscreen,
      onRecallBookmark: recallBookmark,
      onSaveBookmark: handleSaveBookmark,
      onFitToContents: fitToContents,
      onResetView: resetView,
      onCenterSelected: centerSelected,
      onToggleBgmMute: toggleBgmMute,
      onToggleSfxMute: toggleSfxMute,
      onSelectBuilder: selectBuilder,
      onSelectHedgehouse: selectHedgehouse,
      onCycleNest: cycleNest,
      onRecallControlGroup: recallControlGroup,
      onAssignControlGroup: handleAssignControlGroup,
    },
    { dialogOpen },
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

      setSelection((prev) =>
        applyBoxSelectController(prev, hit, builderInRect, additive),
      );
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
  const { affiliatedNestIds, dimWildFlock } = useMemo(
    () => selectAffiliation(selection, hogletBuckets),
    [selection, hogletBuckets],
  );
  const buildMode = mode.kind === "placingNest";
  const relocatingNestId = mode.kind === "relocatingNest" ? mode.nestId : null;

  // Drives the highlighted section of the hotkey helper so the player can see
  // which contextual commands are currently bound based on what's selected.
  const activeHotkeyContext: HedgemonyHotkeyContext | null =
    selectActiveHotkeyContext({
      dialogOpen: spawnHogletOpen || pendingPlacement !== null,
      activeNestId: activeNest?.id ?? null,
      builderSelected,
      hedgehouseSelected,
      singleSelectedHogletId,
    });

  const handleHogletSelect = useCallback(
    (hogletId: string, additive: boolean) => {
      playSfx("select");
      playVoice("hoglet:select", voiceGenderForHoglet(hogletId));
      setSelection((prev) => toggleHogletSelection(prev, hogletId, additive));
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
