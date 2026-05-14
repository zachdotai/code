import type { Nest } from "@main/services/hedgemony/schemas";
import {
  ArrowCounterClockwise,
  ArrowsIn,
  ArrowsOut,
} from "@phosphor-icons/react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
} from "framer-motion";
import type { MutableRefObject, ReactNode, Ref } from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  HEDGEMONY_ZOOM_MAX,
  HEDGEMONY_ZOOM_MIN,
  useHedgemonyViewStore,
} from "../stores/hedgemonyViewStore";
import { clientToWorld, fitZoom, panToCenter } from "../utils/coordinates";
import type { Vec2 } from "../utils/pathfinding";
import { usePanCamera } from "../utils/usePanCamera";
import { BgmControl } from "./BgmControl";
import { type BuilderAnimation, BuilderSprite } from "./BuilderSprite";
import { HedgehouseSprite } from "./HedgehouseSprite";
import { HedgemonyMinimap } from "./HedgemonyMinimap";
import { MapBackdrop } from "./MapBackdrop";
import { NestConstructionSite } from "./NestConstructionSite";
import { NestSprite } from "./NestSprite";
import { SfxControl } from "./SfxControl";

const BUILD_ANIMATION_MS = 1500;

const ZOOM_WHEEL_STEP = 0.0015;
const CLICK_MOVE_THRESHOLD_PX = 4;
const GHOST_SIZE = 96;
const FIT_PADDING_PX = 360;
const FOCUS_ZOOM = 1.4;
const MINIMAP_SIZE_DEFAULT = 168;
const MINIMAP_SIZE_FULLSCREEN = 232;
const CAMERA_ANIM_DURATION_S = 0.42;
// Material Design "standard" cubic-bezier — gentle ease-out that reads as a
// confident snap without feeling abrupt. Typed as a mutable tuple so framer's
// `Easing` overload (which expects a 4-tuple, not `number[]`) accepts it.
const CAMERA_ANIM_EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];

export interface MoveMarker {
  id: number;
  x: number;
  y: number;
}

/** World-space bounding box from a marquee box-selection. */
export interface MapBoxSelection {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** True if shift/cmd/ctrl was held — caller should add to selection, not replace. */
  additive: boolean;
}

/**
 * Imperative camera control exposed by `HedgemonyMapSurface` via ref. Lets the
 * parent (`HedgemonyMapView`) drive smooth camera moves for actions that
 * originate outside the surface itself — e.g., bookmark recall. The motion
 * values live on the surface because they're tied to the rendered transform,
 * and exposing a small API keeps that ownership intact while still allowing
 * the parent to request animated transitions.
 */
export interface MapSurfaceHandle {
  animateToView: (panX: number, panY: number, zoom: number) => void;
  fitToContents: () => void;
  centerSelected: () => void;
  resetView: () => void;
  /** Smooth-pan the camera so a world point sits at the viewport center. */
  centerOnPoint: (worldX: number, worldY: number) => void;
}

interface HedgemonyMapSurfaceProps {
  nests: Nest[];
  selectedNestId: string | null;
  relocatingNestId: string | null;
  builderPath: Vec2[];
  builderPos: Vec2;
  builderPositionRef?: MutableRefObject<Vec2>;
  builderSelected: boolean;
  builderAnimation: BuilderAnimation;
  pendingNest: Nest | null;
  buildMode: boolean;
  moveMarker: MoveMarker | null;
  children?: ReactNode;
  /** Left-click on empty map at world coords. */
  onMapClick?: (worldX: number, worldY: number) => void;
  /** Right-click on empty map at world coords. */
  onMapRightClick?: (worldX: number, worldY: number) => void;
  /** Marquee drag-select completed — world-space rect. */
  onMapBoxSelect?: (selection: MapBoxSelection) => void;
  onNestSelect?: (nest: Nest) => void;
  onBuilderSelect?: () => void;
  onBuilderArrive?: () => void;
  onBuilderSegmentComplete?: (reachedIndex: number) => void;
  onToggleFullscreen?: () => void;
  hedgehouseSelected?: boolean;
  onHedgehouseSelect?: () => void;
}

function HedgemonyMapSurfaceImpl(
  {
    nests,
    selectedNestId,
    relocatingNestId,
    builderPath,
    builderPos,
    builderPositionRef,
    builderSelected,
    builderAnimation,
    pendingNest,
    buildMode,
    moveMarker,
    children,
    onMapClick,
    onMapRightClick,
    onMapBoxSelect,
    onNestSelect,
    onBuilderSelect,
    onBuilderArrive,
    onBuilderSegmentComplete,
    onToggleFullscreen,
    hedgehouseSelected,
    onHedgehouseSelect,
  }: HedgemonyMapSurfaceProps,
  ref: Ref<MapSurfaceHandle>,
) {
  const panX = useHedgemonyViewStore((s) => s.panX);
  const panY = useHedgemonyViewStore((s) => s.panY);
  const zoom = useHedgemonyViewStore((s) => s.zoom);
  const setPan = useHedgemonyViewStore((s) => s.setPan);
  const setZoom = useHedgemonyViewStore((s) => s.setZoom);
  const resetView = useHedgemonyViewStore((s) => s.resetView);
  const fullscreen = useHedgemonyViewStore((s) => s.fullscreen);

  const x = useMotionValue(panX);
  const y = useMotionValue(panY);

  const outerRef = useRef<HTMLDivElement>(null);
  const pointerDown = useRef<{
    x: number;
    y: number;
    onEntity: boolean;
  } | null>(null);
  // Live marquee rect in container-relative pixel coords. Set once the pointer
  // crosses the click/drag threshold so single-clicks never flash a marquee.
  const [marqueeRect, setMarqueeRect] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  // Middle-button drag-pan: anchors the world point under the cursor at the
  // moment middle-down fires, then moves the camera with pointer delta. Stored
  // in a ref so we can read/clear it from window-level listeners without
  // re-rendering the surface on every pointer event.
  const middleDragRef = useRef<{
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
    pointerId: number;
  } | null>(null);

  const commitPan = useCallback(
    (nextX: number, nextY: number) => {
      setPan(nextX, nextY);
    },
    [setPan],
  );

  usePanCamera({
    containerRef: outerRef,
    panX: x,
    panY: y,
    onCommit: commitPan,
  });
  const [placementPointer, setPlacementPointer] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  // Mirror motion values into render state so the minimap viewport rect tracks
  // edge-pan and drag in real time, not just after the 200ms commit debounce.
  const [livePan, setLivePan] = useState({ x: panX, y: panY });
  useMotionValueEvent(x, "change", (value) => {
    setLivePan((prev) => (prev.x === value ? prev : { ...prev, x: value }));
  });
  useMotionValueEvent(y, "change", (value) => {
    setLivePan((prev) => (prev.y === value ? prev : { ...prev, y: value }));
  });

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const sync = () => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const selectedNest =
    selectedNestId !== null
      ? (nests.find((nest) => nest.id === selectedNestId) ?? null)
      : null;
  const relocatingNest =
    relocatingNestId !== null
      ? (nests.find((nest) => nest.id === relocatingNestId) ?? null)
      : null;
  const placementMode = buildMode || relocatingNest !== null;

  const applyView = (nextPanX: number, nextPanY: number, nextZoom = zoom) => {
    x.set(nextPanX);
    y.set(nextPanY);
    setPan(nextPanX, nextPanY);
    setZoom(nextZoom);
  };

  /**
   * Smooth-tween the camera to a target view. Used for explicit "go-to"
   * actions — bookmark recall, double-click focus, fit, center, minimap jump —
   * where a snap feels jarring. Wheel-zoom and middle-drag stay on the instant
   * `applyView` path because the user is driving them continuously.
   */
  const animateToView = useCallback(
    (nextPanX: number, nextPanY: number, nextZoom?: number) => {
      const targetZoom = nextZoom ?? zoom;
      animate(x, nextPanX, {
        duration: CAMERA_ANIM_DURATION_S,
        ease: CAMERA_ANIM_EASE,
      });
      animate(y, nextPanY, {
        duration: CAMERA_ANIM_DURATION_S,
        ease: CAMERA_ANIM_EASE,
      });
      if (targetZoom !== zoom) {
        animate(zoom, targetZoom, {
          duration: CAMERA_ANIM_DURATION_S,
          ease: CAMERA_ANIM_EASE,
          onUpdate: (latest: number) => setZoom(latest),
        });
      }
      // Commit the final pan to the store once the animation settles. The
      // wheel and middle-drag paths commit immediately; this matches their
      // behavior so the persisted state reflects the visible camera.
      window.setTimeout(
        () => setPan(nextPanX, nextPanY),
        CAMERA_ANIM_DURATION_S * 1000,
      );
    },
    [x, y, zoom, setZoom, setPan],
  );

  const focusNest = (nest: Nest) => {
    const nextZoom = Math.max(zoom, FOCUS_ZOOM);
    const next = panToCenter(nest.mapX, nest.mapY, nextZoom);
    animateToView(next.x, next.y, nextZoom);
  };

  const handleMinimapJump = (worldX: number, worldY: number) => {
    const next = panToCenter(worldX, worldY, zoom);
    animateToView(next.x, next.y);
  };

  const fitToContents = useCallback(() => {
    const rect = outerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const points =
      nests.length > 0
        ? nests.map((nest) => ({ x: nest.mapX, y: nest.mapY }))
        : [{ x: builderPos.x, y: builderPos.y }];
    if (nests.length > 0) points.push({ x: builderPos.x, y: builderPos.y });

    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const nextZoom = fitZoom(
      maxX - minX + FIT_PADDING_PX,
      maxY - minY + FIT_PADDING_PX,
      rect.width,
      rect.height,
      HEDGEMONY_ZOOM_MIN,
      HEDGEMONY_ZOOM_MAX,
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const next = panToCenter(centerX, centerY, nextZoom);
    animateToView(next.x, next.y, nextZoom);
  }, [animateToView, nests, builderPos.x, builderPos.y]);

  const centerSelected = useCallback(() => {
    const target = selectedNest
      ? { x: selectedNest.mapX, y: selectedNest.mapY }
      : builderSelected
        ? { x: builderPos.x, y: builderPos.y }
        : null;
    if (!target) return;
    const next = panToCenter(target.x, target.y, zoom);
    animateToView(next.x, next.y);
  }, [
    selectedNest,
    builderSelected,
    builderPos.x,
    builderPos.y,
    zoom,
    animateToView,
  ]);

  const handleResetView = useCallback(() => {
    animateToView(0, 0, 1);
    // resetView() also resets bookmark sentinel state that animateToView
    // doesn't touch. Run it alongside so the rest stays in sync; the
    // pan/zoom store fields will get re-set by animateToView's commit.
    resetView();
  }, [animateToView, resetView]);

  // Exposed once the camera helpers are declared so the parent map view can
  // drive Fit / Center / Reset from hotkeys with the same closures the on-
  // screen buttons use. The helpers are recreated each render (they close
  // over `nests`, `builderPos`, etc.), so depending on them rebuilds the
  // handle each render — that's required for correctness; if we omitted them
  // the handle would call the first-render closure forever.
  const centerOnPoint = useCallback(
    (worldX: number, worldY: number) => {
      const next = panToCenter(worldX, worldY, zoom);
      animateToView(next.x, next.y);
    },
    [animateToView, zoom],
  );

  useImperativeHandle(
    ref,
    () => ({
      animateToView,
      fitToContents: () => fitToContents(),
      centerSelected: () => centerSelected(),
      resetView: () => handleResetView(),
      centerOnPoint: (worldX: number, worldY: number) =>
        centerOnPoint(worldX, worldY),
    }),
    [
      animateToView,
      fitToContents,
      centerSelected,
      handleResetView,
      centerOnPoint,
    ],
  );

  const toWorldCoords = (clientX: number, clientY: number) => {
    const rect = outerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return clientToWorld(clientX, clientY, rect, x.get(), y.get(), zoom);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    const rect = outerRef.current?.getBoundingClientRect();
    const rawZoom = zoom * (1 - event.deltaY * ZOOM_WHEEL_STEP);
    const nextZoom = Math.min(
      HEDGEMONY_ZOOM_MAX,
      Math.max(HEDGEMONY_ZOOM_MIN, rawZoom),
    );
    if (!rect || nextZoom === zoom) {
      setZoom(nextZoom);
      return;
    }
    // Anchor zoom on the world point under the cursor so the map scales toward
    // where the user is looking instead of toward the surface center.
    const localX = event.clientX - rect.left - rect.width / 2;
    const localY = event.clientY - rect.top - rect.height / 2;
    const factor = nextZoom / zoom;
    const currentPanX = x.get();
    const currentPanY = y.get();
    const newPanX = localX * (1 - factor) + currentPanX * factor;
    const newPanY = localY * (1 - factor) + currentPanY * factor;
    applyView(newPanX, newPanY, nextZoom);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      // Middle-click: start drag-pan. Capture the pointer on the surface so
      // we keep getting events even if the cursor leaves the element.
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      middleDragRef.current = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPanX: x.get(),
        startPanY: y.get(),
        pointerId: event.pointerId,
      };
      return;
    }
    if (event.button !== 0) return;
    const onEntity = Boolean(
      (event.target as HTMLElement).closest(
        "[data-hedgemony-nest], [data-hedgemony-hedgehouse], [data-hedgemony-hoglet]",
      ),
    );
    pointerDown.current = {
      x: event.clientX,
      y: event.clientY,
      onEntity,
    };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (middleDragRef.current?.pointerId === event.pointerId) {
      const target = event.currentTarget;
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      setPan(x.get(), y.get());
      middleDragRef.current = null;
      return;
    }
    const start = pointerDown.current;
    pointerDown.current = null;
    if (event.button !== 0) return;

    // Marquee path: convert pixel rect to world rect, fire box-select.
    if (marqueeRect) {
      const target = event.currentTarget;
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      const rect = outerRef.current?.getBoundingClientRect();
      if (rect && onMapBoxSelect) {
        const minSx = Math.min(marqueeRect.startX, marqueeRect.endX);
        const minSy = Math.min(marqueeRect.startY, marqueeRect.endY);
        const maxSx = Math.max(marqueeRect.startX, marqueeRect.endX);
        const maxSy = Math.max(marqueeRect.startY, marqueeRect.endY);
        const aWorld = clientToWorld(
          rect.left + minSx,
          rect.top + minSy,
          rect,
          x.get(),
          y.get(),
          zoom,
        );
        const bWorld = clientToWorld(
          rect.left + maxSx,
          rect.top + maxSy,
          rect,
          x.get(),
          y.get(),
          zoom,
        );
        onMapBoxSelect({
          minX: Math.min(aWorld.x, bWorld.x),
          maxX: Math.max(aWorld.x, bWorld.x),
          minY: Math.min(aWorld.y, bWorld.y),
          maxY: Math.max(aWorld.y, bWorld.y),
          additive: event.shiftKey || event.metaKey || event.ctrlKey,
        });
      }
      setMarqueeRect(null);
      return;
    }

    if (!start || !onMapClick) return;
    if (
      (event.target as HTMLElement).closest(
        "[data-hedgemony-nest], [data-hedgemony-hedgehouse], [data-hedgemony-hoglet]",
      ) &&
      !placementMode
    ) {
      return;
    }

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD_PX) return;

    const world = toWorldCoords(event.clientX, event.clientY);
    if (!world) return;
    onMapClick(world.x, world.y);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = middleDragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      x.set(drag.startPanX + (event.clientX - drag.startClientX));
      y.set(drag.startPanY + (event.clientY - drag.startClientY));
      return;
    }

    // Left-button marquee: while the button is held and we started on empty
    // map, draw a rectangle once the pointer crosses the click/drag threshold.
    const start = pointerDown.current;
    if (start && !start.onEntity && !placementMode) {
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (marqueeRect || Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD_PX) {
        const rect = outerRef.current?.getBoundingClientRect();
        if (rect) {
          // Capture once on entry so we keep getting events outside the surface.
          if (!marqueeRect) {
            const target = event.currentTarget;
            if (!target.hasPointerCapture(event.pointerId)) {
              target.setPointerCapture(event.pointerId);
            }
          }
          setMarqueeRect({
            startX: start.x - rect.left,
            startY: start.y - rect.top,
            endX: event.clientX - rect.left,
            endY: event.clientY - rect.top,
          });
        }
        return;
      }
    }

    if (!placementMode) return;
    const world = toWorldCoords(event.clientX, event.clientY);
    if (world) setPlacementPointer(world);
  };

  const handlePointerLeave = () => {
    setPlacementPointer(null);
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (
      (event.target as HTMLElement).closest(
        "[data-hedgemony-nest], [data-hedgemony-hedgehouse]",
      ) &&
      !placementMode
    ) {
      return;
    }
    const world = toWorldCoords(event.clientX, event.clientY);
    if (!world) return;
    onMapRightClick?.(world.x, world.y);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: map surface owns its own pointer/keyboard model
    <div
      ref={outerRef}
      className={`relative h-full w-full select-none overflow-hidden ${
        placementMode ? "cursor-crosshair" : "cursor-default"
      }`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onContextMenu={handleContextMenu}
    >
      <motion.div
        style={{ x, y, scale: zoom }}
        className="absolute inset-0 origin-center"
      >
        <MapBackdrop nests={nests} />
        <HedgehouseSprite
          selected={hedgehouseSelected}
          onSelect={onHedgehouseSelect}
        />
        {nests.map((nest) => (
          <NestSprite
            key={nest.id}
            nest={nest}
            selected={nest.id === selectedNestId}
            dimmed={nest.id === relocatingNestId}
            onSelect={onNestSelect}
            onFocus={focusNest}
          />
        ))}
        {pendingNest && builderAnimation === "building" && (
          <NestConstructionSite
            key={pendingNest.id}
            mapX={pendingNest.mapX}
            mapY={pendingNest.mapY}
            durationMs={BUILD_ANIMATION_MS}
          />
        )}
        <BuilderSprite
          path={builderPath}
          selected={builderSelected}
          animation={builderAnimation}
          positionRef={builderPositionRef}
          onSelect={onBuilderSelect}
          onArrive={onBuilderArrive}
          onSegmentComplete={onBuilderSegmentComplete}
        />
        {placementMode && placementPointer && (
          <div
            className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2"
            style={{
              transform: `translate(calc(-50% + ${placementPointer.x}px), calc(-50% + ${placementPointer.y}px))`,
            }}
          >
            <div
              className="rounded-full border-(--accent-9) border-2 border-dashed bg-(--accent-3)/30 shadow-lg"
              style={{ width: GHOST_SIZE, height: GHOST_SIZE }}
            >
              {relocatingNest && (
                <div className="flex h-full w-full items-center justify-center px-3 text-center font-medium text-(--accent-11) text-[11px] leading-tight">
                  Move {relocatingNest.name}
                </div>
              )}
            </div>
          </div>
        )}
        <AnimatePresence>
          {moveMarker && (
            <motion.div
              key={moveMarker.id}
              className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 rounded-full border-(--accent-9) border-2"
              style={{
                left: `calc(50% + ${moveMarker.x}px)`,
                top: `calc(50% + ${moveMarker.y}px)`,
              }}
              initial={{ opacity: 0.9, width: 16, height: 16 }}
              animate={{ opacity: 0, width: 72, height: 72 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>
        {children}
      </motion.div>

      {marqueeRect && (
        <div
          aria-hidden
          className="pointer-events-none absolute border border-(--accent-9) border-dashed bg-(--accent-4)/20"
          style={{
            left: Math.min(marqueeRect.startX, marqueeRect.endX),
            top: Math.min(marqueeRect.startY, marqueeRect.endY),
            width: Math.abs(marqueeRect.endX - marqueeRect.startX),
            height: Math.abs(marqueeRect.endY - marqueeRect.startY),
          }}
        />
      )}

      <div
        className="absolute bottom-3 left-3"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <HedgemonyMinimap
          nests={nests}
          builderPos={builderPos}
          panX={livePan.x}
          panY={livePan.y}
          zoom={zoom}
          viewportWidth={containerSize.width}
          viewportHeight={containerSize.height}
          width={fullscreen ? MINIMAP_SIZE_FULLSCREEN : MINIMAP_SIZE_DEFAULT}
          height={fullscreen ? MINIMAP_SIZE_FULLSCREEN : MINIMAP_SIZE_DEFAULT}
          onJump={handleMinimapJump}
        />
      </div>

      <div
        className="absolute right-3 bottom-3 flex items-center gap-2"
        data-no-edge-pan
        onPointerDown={(e) => e.stopPropagation()}
      >
        <BgmControl />
        <SfxControl />
        <button
          type="button"
          onClick={fitToContents}
          className="flex h-7 items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-2 text-(--gray-11) text-[12px] transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
          title="Fit all nests"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={centerSelected}
          disabled={!selectedNest && !builderSelected}
          className="flex h-7 items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-2 text-(--gray-11) text-[12px] transition-colors hover:bg-(--gray-3) hover:text-(--gray-12) disabled:cursor-not-allowed disabled:opacity-50"
          title="Center selected"
        >
          Center
        </button>
        <button
          type="button"
          onClick={handleResetView}
          className="flex h-7 items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-2 text-(--gray-11) text-[12px] transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
          title="Reset view"
        >
          <ArrowCounterClockwise size={12} />
          Reset
        </button>
        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="flex h-7 items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-2 text-(--gray-11) text-[12px] transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
            title={
              fullscreen
                ? "Exit fullscreen (F · Esc)"
                : "Enter fullscreen (F · Shift+F for OS)"
            }
          >
            {fullscreen ? <ArrowsIn size={12} /> : <ArrowsOut size={12} />}
            {fullscreen ? "Exit" : "Fullscreen"}
          </button>
        )}
        <div className="flex h-7 items-center rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-2 text-(--gray-10) text-[12px] tabular-nums">
          {Math.round(zoom * 100)}%
        </div>
      </div>

      {buildMode && (
        <div className="-translate-x-1/2 pointer-events-none absolute top-3 left-1/2 rounded-(--radius-2) border border-(--accent-7) bg-(--accent-3) px-3 py-1 font-medium text-(--accent-11) text-[12px] shadow-sm">
          Click to place a nest · Esc / right-click to cancel
        </div>
      )}
      {relocatingNest && (
        <div className="-translate-x-1/2 pointer-events-none absolute top-3 left-1/2 rounded-(--radius-2) border border-(--accent-7) bg-(--accent-3) px-3 py-1 font-medium text-(--accent-11) text-[12px] shadow-sm">
          Click a new home for {relocatingNest.name} · Esc / right-click to
          cancel
        </div>
      )}
    </div>
  );
}

export const HedgemonyMapSurface = forwardRef<
  MapSurfaceHandle,
  HedgemonyMapSurfaceProps
>(HedgemonyMapSurfaceImpl);
HedgemonyMapSurface.displayName = "HedgemonyMapSurface";
