import { Tooltip } from "@radix-ui/themes";
import {
  type AnimationPlaybackControls,
  animate,
  motion,
  useMotionValue,
} from "framer-motion";
import {
  forwardRef,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { HEDGEMONY_CONFIG } from "../config";
import { BUILDER_NAME } from "../constants/map";
import type { BuilderAnimation } from "../hooks/useBuilderCoordinator";
import { selectNests, useNestStore } from "../stores/nestStore";
import { useCollisionResolvedPosition } from "../utils/collisionResolution";
import type { Vec2 } from "../utils/pathfinding";
import {
  BUILDER_OBSTACLE_RADIUS,
  worldObstacles,
} from "../utils/worldObstacles";
import { AnimatedHedgehog, type HedgehogAnimation } from "./AnimatedHedgehog";

export type { BuilderAnimation };

const SPRITE_SIZE = 72;
const SELECTION_RING_SIZE = SPRITE_SIZE + 18;

const ANIMATION_KEYS: Record<BuilderAnimation, HedgehogAnimation> = {
  idle: "idle",
  walking: "walk",
  building: "action",
};

const ANIMATION_FPS: Record<BuilderAnimation, number> = {
  idle: HEDGEMONY_CONFIG.animation.fps.idle,
  walking: HEDGEMONY_CONFIG.animation.fps.walk,
  building: HEDGEMONY_CONFIG.animation.fps.action,
};

/**
 * Imperative read-side handle. The parent reads the sprite's current on-screen
 * pixel position on demand (e.g. when planning the next walk or hit-testing
 * the marquee), rather than the sprite eagerly mirroring its position into a
 * shared ref each animation frame. Read is cheap — direct motion-value get.
 */
export interface BuilderSpriteHandle {
  getCurrentPosition: () => Vec2;
}

interface BuilderSpriteProps {
  path: Vec2[];
  selected?: boolean;
  animation: BuilderAnimation;
  onSelect?: () => void;
  onArrive?: () => void;
  onSegmentComplete?: (reachedIndex: number) => void;
}

function BuilderSpriteImpl(
  {
    path,
    selected,
    animation,
    onSelect,
    onArrive,
    onSegmentComplete,
  }: BuilderSpriteProps,
  ref: Ref<BuilderSpriteHandle>,
) {
  const builderName = BUILDER_NAME;
  const initial = path[0] ?? { x: 0, y: 0 };
  const motionX = useMotionValue(initial.x);
  const motionY = useMotionValue(initial.y);
  const [facing, setFacing] = useState<"left" | "right">("right");

  const nests = useNestStore(selectNests);
  const getStaticObstacles = useCallback(() => worldObstacles(nests), [nests]);
  const { resolvedX, resolvedY } = useCollisionResolvedPosition(
    "builder",
    motionX,
    motionY,
    BUILDER_OBSTACLE_RADIUS,
    getStaticObstacles,
  );

  useImperativeHandle(
    ref,
    () => ({
      getCurrentPosition: () => ({ x: resolvedX.get(), y: resolvedY.get() }),
    }),
    [resolvedX, resolvedY],
  );

  useEffect(() => {
    if (path.length === 0) return;
    // Always re-sync motion to the planned origin before starting the walk.
    // Vite Fast Refresh / HMR preserves useMotionValue state across module
    // reloads even when the surrounding state has reset, so motionX/motionY
    // can be stranded at a stale position (e.g. inside an obstacle from a
    // pre-fix build) that no longer matches what pathfinding planned for.
    // Without this snap, the first animation segment would tween from the
    // stale position to path[1], visibly cutting through whatever the agent
    // is stuck inside. In the steady state path[0] is the snapped position
    // the coordinator just resolved, so this is a no-op; it only fires on
    // the desync edge cases.
    motionX.set(path[0].x);
    motionY.set(path[0].y);
    if (path.length === 1) {
      const fire = onArrive;
      if (fire) queueMicrotask(fire);
      return;
    }

    let cancelled = false;
    let index = 0;
    let xControls: AnimationPlaybackControls | null = null;
    let yControls: AnimationPlaybackControls | null = null;

    const runSegment = () => {
      if (cancelled) return;
      const from = path[index];
      const to = path[index + 1];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (dx > 0) setFacing("right");
      else if (dx < 0) setFacing("left");
      const dist = Math.hypot(dx, dy);
      if (dist < 0.01) {
        advance();
        return;
      }
      const duration = dist / HEDGEMONY_CONFIG.speeds.builder;
      xControls = animate(motionX, to.x, { duration, ease: "linear" });
      yControls = animate(motionY, to.y, {
        duration,
        ease: "linear",
        onComplete: () => {
          if (cancelled) return;
          advance();
        },
      });
    };

    const advance = () => {
      if (cancelled) return;
      index += 1;
      onSegmentComplete?.(index);
      if (index >= path.length - 1) {
        onArrive?.();
        return;
      }
      runSegment();
    };

    runSegment();

    return () => {
      cancelled = true;
      xControls?.stop();
      yControls?.stop();
    };
  }, [path, motionX, motionY, onArrive, onSegmentComplete]);

  return (
    <motion.div
      className="absolute top-1/2 left-1/2"
      style={{ x: resolvedX, y: resolvedY }}
    >
      <Tooltip
        content={
          <div className="flex flex-col gap-1">
            <span className="font-medium">Builder hedgehog</span>
            <span className="text-[11px] opacity-80">
              Builds nests — homes for long-running goals. Right-click to move.
            </span>
          </div>
        }
        side="bottom"
      >
        <motion.button
          type="button"
          data-hedgemony-nest
          aria-label="Select builder hedgehog"
          className="-translate-x-1/2 -translate-y-1/2 flex cursor-pointer flex-col items-center border-0 bg-transparent p-0"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onContextMenu={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.();
          }}
        >
          <div className="relative">
            {selected && (
              <motion.span
                className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 rounded-full border-(--accent-9) border-2"
                style={{
                  width: SELECTION_RING_SIZE,
                  height: SELECTION_RING_SIZE,
                }}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              />
            )}
            <AnimatedHedgehog
              animation={ANIMATION_KEYS[animation]}
              fps={ANIMATION_FPS[animation]}
              facing={facing}
              size={SPRITE_SIZE}
            />
          </div>
          <div className="mt-1 max-w-35 truncate rounded-(--radius-2) bg-(--gray-3) px-2 py-0.5 font-medium text-(--gray-11) text-[11px] shadow-sm">
            {builderName}
          </div>
        </motion.button>
      </Tooltip>
    </motion.div>
  );
}

export const BuilderSprite = forwardRef(BuilderSpriteImpl);
