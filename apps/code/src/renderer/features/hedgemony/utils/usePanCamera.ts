import type { MotionValue } from "framer-motion";
import { type RefObject, useEffect, useRef } from "react";

const EDGE_ZONE_PX = 36;
const BASE_SPEED_PX_PER_SEC = 950;
const BOOST_MULTIPLIER = 2.2;
const COMMIT_DEBOUNCE_MS = 200;
const MAX_FRAME_DT_S = 0.05;

const KEYS_LEFT = new Set(["ArrowLeft", "KeyA"]);
const KEYS_RIGHT = new Set(["ArrowRight", "KeyD"]);
const KEYS_UP = new Set(["ArrowUp", "KeyW"]);
const KEYS_DOWN = new Set(["ArrowDown", "KeyS"]);
const PAN_KEYS = new Set([
  ...KEYS_LEFT,
  ...KEYS_RIGHT,
  ...KEYS_UP,
  ...KEYS_DOWN,
]);

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
    let lastTs: number | null = null;
    let rafId = 0;
    let commitTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleCommit = () => {
      if (commitTimer) return;
      commitTimer = setTimeout(() => {
        commitTimer = null;
        onCommitRef.current(panX.get(), panY.get());
      }, COMMIT_DEBOUNCE_MS);
    };

    const tick = (ts: number) => {
      const dt =
        lastTs === null ? 0 : Math.min(MAX_FRAME_DT_S, (ts - lastTs) / 1000);
      lastTs = ts;

      let dx = 0;
      let dy = 0;

      if (!isTypingTarget(document.activeElement)) {
        if (anyHeld(pressed, KEYS_LEFT)) dx += 1;
        if (anyHeld(pressed, KEYS_RIGHT)) dx -= 1;
        if (anyHeld(pressed, KEYS_UP)) dy += 1;
        if (anyHeld(pressed, KEYS_DOWN)) dy -= 1;
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
        const exclusions = el.querySelectorAll("[data-no-edge-pan]");
        let excluded = false;
        for (const zone of exclusions) {
          const zr = zone.getBoundingClientRect();
          if (
            px >= zr.left - EDGE_ZONE_PX &&
            px <= zr.right + EDGE_ZONE_PX &&
            py >= zr.top - EDGE_ZONE_PX &&
            py <= zr.bottom
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
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey) boost = true;
      if (!PAN_KEYS.has(e.code)) return;
      if (isTypingTarget(document.activeElement)) return;
      pressed.add(e.code);
      e.preventDefault();
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
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("pointerout", onPointerLeaveDoc);

    return () => {
      cancelAnimationFrame(rafId);
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
  }, [containerRef, panX, panY]);
}
