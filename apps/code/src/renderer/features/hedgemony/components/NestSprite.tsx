import type { Nest } from "@main/services/hedgemony/schemas";
import { Tooltip } from "@radix-ui/themes";
import { animate, motion, useMotionValue } from "framer-motion";
import { useEffect, useState } from "react";
import { AnimatedHedgehog } from "./AnimatedHedgehog";

const SPRITE_SIZE = 96;
const SELECTION_RING_SIZE = SPRITE_SIZE + 22;
const NEST_SPEED = 100;
const NEST_EASE = [0.4, 0, 0.2, 1] as const;
const WALK_ANIMATION = "skins/default/walk/tile";
const IDLE_ANIMATION = "skins/default/idle/tile";

interface NestSpriteProps {
  nest: Nest;
  selected?: boolean;
  dimmed?: boolean;
  onSelect?: (nest: Nest) => void;
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
}: NestSpriteProps) {
  const motionX = useMotionValue(nest.mapX);
  const motionY = useMotionValue(nest.mapY);
  const [isMoving, setIsMoving] = useState(false);
  const [facing, setFacing] = useState<"left" | "right">("right");

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

  return (
    <motion.div
      className="absolute top-1/2 left-1/2"
      style={{ x: motionX, y: motionY, opacity: dimmed ? 0.42 : 1 }}
    >
      <Tooltip content={nest.goalPrompt} side="bottom">
        <motion.button
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
        >
          <div className="relative">
            <div
              className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 rounded-full"
              style={{
                width: selected ? 260 : 220,
                height: selected ? 260 : 220,
                background: territoryBackground(nest),
              }}
            />
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
            <div
              className="flex items-center justify-center rounded-full bg-(--gray-2) shadow-md ring-(--accent-7) ring-2"
              style={{ width: SPRITE_SIZE, height: SPRITE_SIZE }}
            >
              <AnimatedHedgehog
                animation={isMoving ? WALK_ANIMATION : IDLE_ANIMATION}
                fps={isMoving ? 14 : 8}
                facing={facing}
                size={SPRITE_SIZE * 0.8}
              />
            </div>
          </div>
          <div className="mt-1 max-w-[160px] truncate rounded-(--radius-2) bg-(--gray-3) px-2 py-0.5 font-medium text-(--gray-12) text-[12px] shadow-sm">
            {nest.name}
          </div>
        </motion.button>
      </Tooltip>
    </motion.div>
  );
}
