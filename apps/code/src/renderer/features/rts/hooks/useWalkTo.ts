import { type MotionValue, useMotionValue } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { HEDGEMONY_CONFIG } from "../config";
import { sceneTicker } from "../runtime/SceneTicker";
import type { Vec2 } from "../utils/pathfinding";

interface WalkToResult {
  motionX: MotionValue<number>;
  motionY: MotionValue<number>;
  isWalking: boolean;
  facing: "left" | "right";
}

/**
 * Tweens a sprite from its current position to `(targetX, targetY)`. If
 * `transitPath` is provided, it's treated as an ordered list of waypoints to
 * walk through *before* settling at the target — used so hoglets visibly route
 * around nests instead of clipping through them.
 *
 * Each segment is interpolated linearly at `HEDGEMONY_CONFIG.speeds.hoglet`
 * px/sec, driven by the shared SceneTicker so the simulation can be paused,
 * stepped, or replaced with a deterministic clock in tests.
 */
export function useWalkTo(
  targetX: number,
  targetY: number,
  transitPath?: Vec2[],
): WalkToResult {
  const motionX = useMotionValue(targetX);
  const motionY = useMotionValue(targetY);
  const [isWalking, setIsWalking] = useState(false);
  const [facing, setFacing] = useState<"left" | "right">("right");
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      motionX.set(targetX);
      motionY.set(targetY);
      return;
    }

    const segments: Vec2[] = [];
    if (transitPath && transitPath.length > 1) {
      for (let i = 1; i < transitPath.length; i++) {
        segments.push(transitPath[i]);
      }
    }
    const last = segments[segments.length - 1];
    if (!last || last.x !== targetX || last.y !== targetY) {
      segments.push({ x: targetX, y: targetY });
    }

    if (segments.length === 0) return;

    let segIndex = 0;
    let started = false;
    let segStartX = motionX.get();
    let segStartY = motionY.get();
    let segDurationS = 0;
    let segElapsedS = 0;
    let segActive = false;

    const beginSegment = (): boolean => {
      while (segIndex < segments.length) {
        const seg = segments[segIndex];
        segStartX = motionX.get();
        segStartY = motionY.get();
        const dx = seg.x - segStartX;
        const dy = seg.y - segStartY;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) {
          segIndex++;
          continue;
        }
        segDurationS = dist / HEDGEMONY_CONFIG.speeds.hoglet;
        segElapsedS = 0;
        segActive = true;
        if (!started) {
          started = true;
          setIsWalking(true);
        }
        if (dx > 0) setFacing("right");
        else if (dx < 0) setFacing("left");
        return true;
      }
      segActive = false;
      setIsWalking(false);
      return false;
    };

    if (!beginSegment()) return;

    const unsubscribe = sceneTicker.on((deltaMs) => {
      if (!segActive) return;
      segElapsedS += deltaMs / 1000;
      const seg = segments[segIndex];
      if (segElapsedS >= segDurationS) {
        motionX.set(seg.x);
        motionY.set(seg.y);
        segIndex++;
        beginSegment();
        return;
      }
      const t = segElapsedS / segDurationS;
      motionX.set(segStartX + (seg.x - segStartX) * t);
      motionY.set(segStartY + (seg.y - segStartY) * t);
    });

    return () => {
      unsubscribe();
      setIsWalking(false);
    };
  }, [targetX, targetY, transitPath, motionX, motionY]);

  return { motionX, motionY, isWalking, facing };
}
