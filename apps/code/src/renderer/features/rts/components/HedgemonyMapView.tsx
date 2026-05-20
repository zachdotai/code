import { PointerSensor } from "@dnd-kit/dom";
import type { DragDropEvents } from "@dnd-kit/react";
import { DragDropProvider } from "@dnd-kit/react";
import { genderForName } from "@main/services/rts/hoglet-names";
import type { Nest } from "@main/services/rts/schemas";
import { AnimatePresence } from "framer-motion";
import { useCallback, useMemo, useRef, useState } from "react";
import { useBgmStore } from "../audio/bgmStore";
import { playSfx } from "../audio/sfx";
import { useSfxStore } from "../audio/sfxStore";
import { playVoice } from "../audio/voice";
import { BUILDER_NAME } from "../constants/map";
import { useBuilderCoordinator } from "../hooks/useBuilderCoordinator";
import { useCameraBookmarks } from "../hooks/useCameraBookmarks";
import { useHedgemonyCommands } from "../hooks/useHedgemonyCommands";
import { useHedgemonyDerivedState } from "../hooks/useHedgemonyDerivedState";
import { useHedgemonyEscapeKey } from "../hooks/useHedgemonyEscapeKey";
import { useHedgemonyFullscreen } from "../hooks/useHedgemonyFullscreen";
import { useHedgemonyHotkeys } from "../hooks/useHedgemonyHotkeys";
import { useHedgemonyMapInput } from "../hooks/useHedgemonyMapInput";
import { useHedgemonySelectionSync } from "../hooks/useHedgemonySelectionSync";
import { useHedgemonySubscriptions } from "../hooks/useHedgemonySubscriptions";
import { useMoveMarker } from "../hooks/useMoveMarker";
import { useSignalIngestion } from "../hooks/useSignalIngestion";
import {
  type HogletDragSource,
  type HogletDragTarget,
  handleHogletDrop,
} from "../service/hogletMutations";
import type { ViewMode } from "../state/computeMapClickAction";
import type { Selection } from "../state/HedgemonyController";
import { selectNests, useNestStore } from "../stores/nestStore";
import { useSpawnDialogStore } from "../stores/spawnDialogStore";
import type { Vec2 } from "../utils/pathfinding";
import { BuilderCommandPanel } from "./BuilderCommandPanel";
import type { BuilderSpriteHandle } from "./BuilderSprite";
import { DyingHogletLayer } from "./DyingHogletLayer";
import { DyingNestLayer } from "./DyingNestLayer";
import { FinOpsPanel } from "./FinOpsPanel";
import { HedgehouseCommandPanel } from "./HedgehouseCommandPanel";
import { HedgemonyFullscreenShell } from "./HedgemonyFullscreenShell";
import { HedgemonyHotkeyHelper } from "./HedgemonyHotkeyHelper";
import {
  HedgemonyMapSurface,
  type MapSurfaceHandle,
} from "./HedgemonyMapSurface";
import { HogletDetailPanel } from "./HogletDetailPanel";
import { MultiHogletDetailPanel } from "./MultiHogletDetailPanel";
import { NestBroodCluster } from "./NestBroodCluster";
import { NestDetailPanel } from "./NestDetailPanel";
import { type NestCreationMode, PlaceNestDialog } from "./PlaceNestDialog";
import { SpawnHogletPanel } from "./SpawnHogletPanel";
import { WildHogletFlock } from "./WildHogletFlock";

export function HedgemonyMapView() {
  const nests = useNestStore(selectNests);

  const [mode, setMode] = useState<ViewMode>({ kind: "browsing" });
  const [pendingPlacement, setPendingPlacement] = useState<{
    x: number;
    y: number;
    creationMode: NestCreationMode;
  } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const { moveMarker, flashMoveMarker } = useMoveMarker();
  const spawnHogletOpen = useSpawnDialogStore((s) => s.spawnHogletOpen);
  const openSpawnHoglet = useSpawnDialogStore((s) => s.openSpawnHoglet);
  const closeSpawnHoglet = useSpawnDialogStore((s) => s.closeSpawnHoglet);
  const {
    fullscreen,
    exitFullscreen,
    toggleFullscreen,
    toggleInAppFullscreen,
  } = useHedgemonyFullscreen();
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

  useHedgemonySelectionSync(selection);
  useHedgemonyEscapeKey({
    mode,
    selection,
    fullscreen,
    helperOpen,
    setMode,
    setSelection,
    exitFullscreen,
  });

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

  const {
    selectBuilder,
    selectHedgehouse,
    cycleNest,
    handleAssignControlGroup,
    recallControlGroup,
    handleHogletSelect,
    beginBuildNest,
    beginQuickNest,
    beginRelocateNest,
    clickSelectNest,
    clickSelectBuilder,
    clickSelectHedgehouse,
    toggleMoneyHog,
    focusHoglet,
  } = useHedgemonyCommands({
    nests,
    selection,
    setMode,
    setSelection,
    builderPosOrFallback,
    surfaceRef,
  });

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

  const {
    handleMapClick,
    handleMapRightClick,
    handleBoxSelect,
    unitObstacles,
  } = useHedgemonyMapInput({
    mode,
    selection,
    nests,
    builder,
    builderPosOrFallback,
    setMode,
    setSelection,
    setPendingPlacement,
    flashMoveMarker,
  });

  const handlePlaceNestCreated = useCallback(
    (created: Nest) => {
      playSfx("place");
      playVoice("builder:place_nest", genderForName(BUILDER_NAME));
      builder.startWalk(
        { x: created.mapX, y: created.mapY },
        builderPosOrFallback(),
        "build",
        created,
        unitObstacles({ includeBuilder: false }),
      );
    },
    [builder, builderPosOrFallback, unitObstacles],
  );

  const {
    activeNest,
    builderSelected,
    hedgehouseSelected,
    selectedHogletIds,
    activeHoglet,
    affiliatedNestIds,
    dimWildFlock,
    buildMode,
    relocatingNestId,
    activeHotkeyContext,
  } = useHedgemonyDerivedState({ selection, mode, nests, dialogOpen });

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
        onNestSelect={(nest) => clickSelectNest(nest.id)}
        onBuilderSelect={clickSelectBuilder}
        onBuilderArrive={builder.handleArrive}
        onBuilderSegmentComplete={builder.handleSegmentComplete}
        onToggleFullscreen={toggleFullscreen}
        hedgehouseSelected={hedgehouseSelected}
        onHedgehouseSelect={clickSelectHedgehouse}
        moneyHogSelected={selection?.type === "money-hog"}
        onMoneyHogSelect={toggleMoneyHog}
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
            onFocusHoglet={focusHoglet}
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
        onCreated={handlePlaceNestCreated}
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
      <HedgemonyFullscreenShell
        fullscreen={fullscreen}
        contextActive={activeHotkeyContext !== null}
        onExitFullscreen={exitFullscreen}
      >
        {mapContent}
      </HedgemonyFullscreenShell>
    </DragDropProvider>
  );
}
