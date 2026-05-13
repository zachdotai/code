import { Tooltip } from "@radix-ui/themes";
import { motion } from "framer-motion";
import { AnimatedHedgehog } from "./AnimatedHedgehog";

const SPRITE_SIZE = 72;
const SELECTION_RING_SIZE = SPRITE_SIZE + 18;

export type BuilderAnimation = "idle" | "walking" | "building";

const ANIMATION_KEYS: Record<BuilderAnimation, string> = {
  idle: "skins/default/idle/tile",
  walking: "skins/default/walk/tile",
  building: "skins/default/action/tile",
};

const ANIMATION_FPS: Record<BuilderAnimation, number> = {
  idle: 8,
  walking: 14,
  building: 12,
};

interface BuilderSpriteProps {
  x: number;
  y: number;
  selected?: boolean;
  animation: BuilderAnimation;
  facing: "left" | "right";
  onSelect?: () => void;
  onArrive?: () => void;
}

export function BuilderSprite({
  x,
  y,
  selected,
  animation,
  facing,
  onSelect,
  onArrive,
}: BuilderSpriteProps) {
  return (
    <motion.div
      className="absolute top-1/2 left-1/2"
      initial={false}
      animate={{ x, y }}
      transition={{ type: "spring", damping: 24, stiffness: 90, mass: 0.7 }}
      onAnimationComplete={() => onArrive?.()}
    >
      <Tooltip content="Builder hedgehog · click to select" side="bottom">
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
          <div className="mt-1 max-w-[120px] truncate rounded-(--radius-2) bg-(--gray-3) px-2 py-0.5 font-medium text-(--gray-11) text-[11px] shadow-sm">
            Builder
          </div>
        </motion.button>
      </Tooltip>
    </motion.div>
  );
}
