import type { MotionValue } from "framer-motion";
import { type RefObject, useEffect, useRef } from "react";
import { HEDGEMONY_CONFIG } from "../config";
import { sceneTicker } from "../runtime/SceneTicker";

const EDGE_ZONE_PX = 36;
const BASE_SPEED_PX_PER_SEC = HEDGEMONY_CONFIG.speeds.panCamera;
const BOOST_MULTIPLIER = 2.2;
const COMMIT_DEBOUNCE_MS = 200;

const ARROW_LEFT = new Set(["ArrowLeft"]);
const ARROW_RIGHT = new Set(["ArrowRight"]);
const ARROW_UP = new Set(["ArrowUp"]);
const ARROW_DOWN = new Set(["ArrowDown"]);
const WASD_LEFT = new Set(["KeyA"]);
const WASD_RIGHT = new Set(["KeyD"]);
const WASD_UP = new Set(["KeyW"]);
const WASD_DOWN = new Set(["KeyS"]);
const ARROW_PAN_KEYS = new Set([
  ...ARROW_LEFT,
  ...ARROW_RIGHT,
  ...ARROW_UP,
  ...ARROW_DOWN,
]);
const WASD_PAN_KEYS = new Set([
  ...WASD_LEFT,
  ...WASD_RIGHT,
  ...WASD_UP,
  ...WASD_DOWN,
]);
const PAN_KEYS = new Set([...ARROW_PAN_KEYS, ...WASD_PAN_KEYS]);

function anyHeld(pressed: Set<string>, keys: Set<string>) {
  for (const key of keys) if (pressed.has(key)) return true;
  return false;
}

function isTypingTarget(target: Element | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

interface UsePanCameraOptions {
  containerRef: RefObject<HTMLElement | null>;
  panX: MotionValue<number>;
  panY: MotionValue<number>;
  onCommit: (x: number, y: number) => void;
  wasdEnabled?: boolean;
}

/**
 * RTS-style camera pan: arrow keys / WASD + edge-of-viewport mouse scroll.
 * Speed ramps from 0 at the edge-zone boundary up to BASE_SPEED at the very
 * edge so fine adjustments are easy and full traversal is fast.
 */
export function usePanCamera({
  containerRef,
  panX,
  panY,
  onCommit,
  wasdEnabled = true,
}: UsePanCameraOptions) {
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const pressed = new Set<string>();
    let boost = false;
    let pointerLocal: { x: number; y: number } | null = null;
    let pointerInside = false;
    let tickerUnsubscribe: (() => void) | null = null;
    let firstFrameSinceStart = false;
    let commitTimer: ReturnType<typeof setTimeout> | null = null;

    // Cache the edge-pan exclusion zones so we don't re-query the DOM each
    // frame at 60fps. A MutationObserver invalidates the cache when the
    // surface's subtree changes.
    let exclusionsCache: Element[] | null = null;
    const getExclusions = (): Element[] => {
      if (exclusionsCache === null) {
        exclusionsCache = Array.from(el.querySelectorAll("[data-no-edge-pan]"));
      }
      return exclusionsCache;
    };
    const observer = new MutationObserver(() => {
      exclusionsCache = null;
    });
    observer.observe(el, {
      childList: true,
      subtree: true,
      attributeFilter: ["data-no-edge-pan"],
    });

    const isPointerNearEdge = (): boolean => {
      if (!pointerInside || !pointerLocal) return false;
      const rect = el.getBoundingClientRect();
      const { x: lx, y: ly } = pointerLocal;
      return (
        lx < EDGE_ZONE_PX ||
        lx > rect.width - EDGE_ZONE_PX ||
        ly < EDGE_ZONE_PX ||
        ly > rect.height - EDGE_ZONE_PX
      );
    };

    const scheduleCommit = () => {
      if (commitTimer) return;
      commitTimer = setTimeout(() => {
        commitTimer = null;
        onCommitRef.current(panX.get(), panY.get());
      }, COMMIT_DEBOUNCE_MS);
    };

    const stopLoop = () => {
      if (tickerUnsubscribe !== null) {
        tickerUnsubscribe();
        tickerUnsubscribe = null;
      }
    };

    const tick = (deltaMs: number) => {
      // Skip the first frame after (re)subscribing — matches the prior rAF
      // implementation which always seeded lastTs=null on startLoop and so
      // produced dt=0 for the first frame. If we trusted the ticker's dt
      // here, a freshly-subscribed loop would apply a real-time delta on
      // frame 0 against zero key input integration.
      const dt = firstFrameSinceStart ? 0 : deltaMs / 1000;
      firstFrameSinceStart = false;

      let dx = 0;
      let dy = 0;

      if (!isTypingTarget(document.activeElement)) {
        if (anyHeld(pressed, ARROW_LEFT)) dx += 1;
        if (anyHeld(pressed, ARROW_RIGHT)) dx -= 1;
        if (anyHeld(pressed, ARROW_UP)) dy += 1;
        if (anyHeld(pressed, ARROW_DOWN)) dy -= 1;
        if (wasdEnabled) {
          if (anyHeld(pressed, WASD_LEFT)) dx += 1;
          if (anyHeld(pressed, WASD_RIGHT)) dx -= 1;
          if (anyHeld(pressed, WASD_UP)) dy += 1;
          if (anyHeld(pressed, WASD_DOWN)) dy -= 1;
        }
      }
      // Normalize keyboard diagonal so corner movement isn't sqrt(2) faster.
      const keyMag = Math.hypot(dx, dy);
      if (keyMag > 1) {
        dx /= keyMag;
        dy /= keyMag;
      }

      if (pointerInside && pointerLocal && document.hasFocus()) {
        const rect = el.getBoundingClientRect();
        const lx = pointerLocal.x;
        const ly = pointerLocal.y;

        const px = rect.left + lx;
        const py = rect.top + ly;
        let excluded = false;
        for (const zone of getExclusions()) {
          const zr = zone.getBoundingClientRect();
          if (
            px >= zr.left - EDGE_ZONE_PX &&
            px <= zr.right + EDGE_ZONE_PX &&
            py >= zr.top - EDGE_ZONE_PX &&
            py <= zr.bottom + EDGE_ZONE_PX
          ) {
            excluded = true;
            break;
          }
        }
        if (!excluded) {
          if (lx < EDGE_ZONE_PX) dx += (EDGE_ZONE_PX - lx) / EDGE_ZONE_PX;
          else if (lx > rect.width - EDGE_ZONE_PX)
            dx -= (lx - (rect.width - EDGE_ZONE_PX)) / EDGE_ZONE_PX;
          if (ly < EDGE_ZONE_PX) dy += (EDGE_ZONE_PX - ly) / EDGE_ZONE_PX;
          else if (ly > rect.height - EDGE_ZONE_PX)
            dy -= (ly - (rect.height - EDGE_ZONE_PX)) / EDGE_ZONE_PX;
        }
      }

      if (dx !== 0 || dy !== 0) {
        // Clamp combined magnitude so key + edge stacking doesn't go absurd.
        const mag = Math.hypot(dx, dy);
        if (mag > 1) {
          dx /= mag;
          dy /= mag;
        }
        const speed = BASE_SPEED_PX_PER_SEC * (boost ? BOOST_MULTIPLIER : 1);
        panX.set(panX.get() + dx * speed * dt);
        panY.set(panY.get() + dy * speed * dt);
        scheduleCommit();
        return;
      }

      // No movement this frame. Unsubscribe from the ticker unless something
      // might still trigger panning next frame — held pan keys, or cursor
      // near an edge.
      if (pressed.size === 0 && !isPointerNearEdge()) {
        stopLoop();
      }
    };

    const startLoop = () => {
      if (tickerUnsubscribe !== null) return;
      firstFrameSinceStart = true;
      tickerUnsubscribe = sceneTicker.on(tick);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey) boost = true;
      if (!PAN_KEYS.has(e.code)) return;
      if (!wasdEnabled && WASD_PAN_KEYS.has(e.code)) return;
      if (isTypingTarget(document.activeElement)) return;
      pressed.add(e.code);
      e.preventDefault();
      startLoop();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.shiftKey) boost = false;
      pressed.delete(e.code);
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const lx = e.clientX - rect.left;
      const ly = e.clientY - rect.top;
      pointerLocal = { x: lx, y: ly };
      pointerInside =
        lx >= 0 && lx <= rect.width && ly >= 0 && ly <= rect.height;
      if (pointerInside && isPointerNearEdge()) startLoop();
    };

    const onWindowBlur = () => {
      pressed.clear();
      boost = false;
      pointerInside = false;
    };

    const onPointerLeaveDoc = (e: PointerEvent) => {
      // Cursor left the document — most often to OS chrome at the top of the
      // screen (macOS menu bar reveal, traffic-light region). Without this
      // carve-out, edge-pan would die exactly as the user pushed against the
      // screen edge to pan up. If the last known position was already inside
      // an edge zone, clamp it to the boundary and keep panning until the
      // cursor re-enters the document.
      if (e.relatedTarget !== null) return;
      if (!pointerLocal) {
        pointerInside = false;
        return;
      }
      const rect = el.getBoundingClientRect();
      const { x: lx, y: ly } = pointerLocal;
      const inEdgeZone =
        lx < EDGE_ZONE_PX ||
        lx > rect.width - EDGE_ZONE_PX ||
        ly < EDGE_ZONE_PX ||
        ly > rect.height - EDGE_ZONE_PX;
      if (!inEdgeZone) {
        pointerInside = false;
        return;
      }
      pointerLocal = {
        x: Math.max(0, Math.min(rect.width, lx)),
        y: Math.max(0, Math.min(rect.height, ly)),
      };
      pointerInside = true;
      startLoop();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("pointerout", onPointerLeaveDoc);

    return () => {
      stopLoop();
      observer.disconnect();
      if (commitTimer) {
        clearTimeout(commitTimer);
        onCommitRef.current(panX.get(), panY.get());
      }
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("pointerout", onPointerLeaveDoc);
    };
  }, [containerRef, panX, panY, wasdEnabled]);
}
