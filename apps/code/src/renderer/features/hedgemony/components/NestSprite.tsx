import { useDroppable } from "@dnd-kit/react";
import type { Nest } from "@main/services/hedgemony/schemas";
import { Tooltip } from "@radix-ui/themes";
import nestImage from "@renderer/assets/images/hedgemony/nest.png";
import { animate, motion, useMotionValue } from "framer-motion";
import { useEffect, useState } from "react";
import { selectHedgehogState, useNestStore } from "../stores/nestStore";
import { AnimatedHedgehog } from "./AnimatedHedgehog";

const NEST_SIZE = 140;
const HOG_SIZE_IDLE = 44;
const HOG_SIZE_MOVING = 88;
const SELECTION_RING_SIZE = NEST_SIZE + 24;
const DROP_RING_SIZE = NEST_SIZE + 44;
const TERRITORY_SIZE = 220;
const TERRITORY_SIZE_SELECTED = 260;
const TERRITORY_SIZE_DROP_TARGET = 280;
const NEST_SPEED = 100;
const NEST_EASE = [0.4, 0, 0.2, 1] as const;
const WALK_ANIMATION = "walk" as const;
const IDLE_ANIMATION = "idle" as const;
const TICKING_ANIMATION = "action" as const;

function residentAnimation({
  isMoving,
  isTicking,
}: {
  isMoving: boolean;
  isTicking: boolean;
}): "walk" | "idle" | "action" {
  if (isMoving) return WALK_ANIMATION;
  if (isTicking) return TICKING_ANIMATION;
  return IDLE_ANIMATION;
}

interface NestSpriteProps {
  nest: Nest;
  selected?: boolean;
  dimmed?: boolean;
  onSelect?: (nest: Nest) => void;
  onFocus?: (nest: Nest) => void;
}

function territoryBackground(nest: Nest): string {
  if (nest.health !== "ok") {
    return "radial-gradient(circle, rgba(251, 146, 60, 0.22) 0%, rgba(251, 146, 60, 0.1) 42%, transparent 72%)";
  }
  if (nest.status === "needs_attention") {
    return "radial-gradient(circle, rgba(248, 113, 113, 0.22) 0%, rgba(248, 113, 113, 0.1) 42%, transparent 72%)";
  }
  if (nest.status === "dormant") {
    return "radial-gradient(circle, rgba(148, 163, 184, 0.18) 0%, rgba(148, 163, 184, 0.08) 42%, transparent 72%)";
  }
  return "radial-gradient(circle, rgba(251, 146, 60, 0.18) 0%, rgba(251, 146, 60, 0.08) 42%, transparent 72%)";
}

export function NestSprite({
  nest,
  selected,
  dimmed,
  onSelect,
  onFocus,
}: NestSpriteProps) {
  const motionX = useMotionValue(nest.mapX);
  const motionY = useMotionValue(nest.mapY);
  const [isMoving, setIsMoving] = useState(false);
  const [facing, setFacing] = useState<"left" | "right">("right");
  const hedgehogState = useNestStore(selectHedgehogState(nest.id));
  const isTicking = hedgehogState?.state === "ticking";

  const { ref: dropRef, isDropTarget } = useDroppable({
    id: `nest-drop-${nest.id}`,
    data: { type: "nest", nestId: nest.id },
  });

  useEffect(() => {
    const fromX = motionX.get();
    const fromY = motionY.get();
    const dx = nest.mapX - fromX;
    const dy = nest.mapY - fromY;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) {
      motionX.set(nest.mapX);
      motionY.set(nest.mapY);
      return;
    }
    if (dx > 0) setFacing("right");
    else if (dx < 0) setFacing("left");
    setIsMoving(true);
    const duration = dist / NEST_SPEED;
    const xControls = animate(motionX, nest.mapX, {
      duration,
      ease: NEST_EASE,
    });
    const yControls = animate(motionY, nest.mapY, {
      duration,
      ease: NEST_EASE,
      onComplete: () => setIsMoving(false),
    });
    return () => {
      xControls.stop();
      yControls.stop();
    };
  }, [nest.mapX, nest.mapY, motionX, motionY]);

  const showResident = nest.status !== "dormant";

  return (
    <motion.div
      className="absolute top-1/2 left-1/2"
      style={{ x: motionX, y: motionY, opacity: dimmed ? 0.42 : 1 }}
    >
      <Tooltip content={nest.goalPrompt} side="bottom">
        <motion.button
          ref={dropRef}
          type="button"
          data-hedgemony-nest
          aria-label={`Select ${nest.name}`}
          className="-translate-x-1/2 -translate-y-1/2 flex cursor-pointer flex-col items-center border-0 bg-transparent p-0"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onContextMenu={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(nest);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onFocus?.(nest);
          }}
        >
          <div
            className="relative"
            style={{ width: NEST_SIZE, height: NEST_SIZE }}
          >
            <div
              className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 rounded-full transition-all duration-150"
              style={{
                width: isDropTarget
                  ? TERRITORY_SIZE_DROP_TARGET
                  : selected
                    ? TERRITORY_SIZE_SELECTED
                    : TERRITORY_SIZE,
                height: isDropTarget
                  ? TERRITORY_SIZE_DROP_TARGET
                  : selected
                    ? TERRITORY_SIZE_SELECTED
                    : TERRITORY_SIZE,
                background: territoryBackground(nest),
                filter: isDropTarget ? "saturate(1.6) brightness(1.1)" : "none",
              }}
            />
            {isTicking && (
              <motion.div
                aria-hidden
                className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 rounded-full"
                style={{
                  width: TERRITORY_SIZE_SELECTED,
                  height: TERRITORY_SIZE_SELECTED,
                  background:
                    "radial-gradient(circle, rgba(253, 224, 71, 0.40) 0%, rgba(253, 224, 71, 0.18) 50%, transparent 78%)",
                  mixBlendMode: "screen",
                }}
                initial={{ opacity: 0.55, scale: 0.9 }}
                animate={{
                  opacity: [0.55, 0.95, 0.55],
                  scale: [0.9, 1.05, 0.9],
                }}
                transition={{
                  duration: 1.6,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "easeInOut",
                }}
              />
            )}
            {isDropTarget && (
              <motion.span
                className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 rounded-full border-(--accent-9) border-2 border-dashed"
                style={{
                  width: DROP_RING_SIZE,
                  height: DROP_RING_SIZE,
                }}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              />
            )}
            {selected && !isDropTarget && (
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
            <motion.img
              src={nestImage}
              alt=""
              className="pointer-events-none absolute inset-0 select-none drop-shadow-md"
              style={{ width: NEST_SIZE, height: NEST_SIZE }}
              draggable={false}
              animate={{
                opacity: isMoving ? 0 : 1,
                scale: isMoving ? 0.85 : 1,
              }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            />
            {showResident && (
              <motion.div
                className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute"
                animate={{
                  left: "50%",
                  top: isMoving ? "50%" : "72%",
                }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <AnimatedHedgehog
                  animation={residentAnimation({ isMoving, isTicking })}
                  fps={isMoving ? 14 : isTicking ? 10 : 8}
                  facing={facing}
                  size={isMoving ? HOG_SIZE_MOVING : HOG_SIZE_IDLE}
                />
              </motion.div>
            )}
          </div>
          <div className="mt-1 max-w-[160px] truncate rounded-(--radius-2) bg-(--gray-3) px-2 py-0.5 font-medium text-(--gray-12) text-[12px] shadow-sm">
            {nest.name}
          </div>
        </motion.button>
      </Tooltip>
    </motion.div>
  );
}
