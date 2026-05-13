import { Tooltip } from "@radix-ui/themes";
import explorerHog from "@renderer/assets/images/hedgehogs/explorer-hog.png";
import { motion } from "framer-motion";

const SPRITE_SIZE = 64;
const SELECTION_RING_SIZE = SPRITE_SIZE + 18;

interface BuilderSpriteProps {
  x: number;
  y: number;
  selected?: boolean;
  onSelect?: () => void;
}

export function BuilderSprite({
  x,
  y,
  selected,
  onSelect,
}: BuilderSpriteProps) {
  return (
    <motion.div
      className="absolute top-1/2 left-1/2"
      initial={false}
      animate={{ x, y }}
      transition={{ type: "spring", damping: 22, stiffness: 220, mass: 0.5 }}
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
            <div
              className="flex items-center justify-center rounded-full bg-(--gray-2) shadow-md ring-(--gray-7) ring-2"
              style={{ width: SPRITE_SIZE, height: SPRITE_SIZE }}
            >
              <img
                src={explorerHog}
                alt=""
                className="pointer-events-none select-none"
                style={{
                  width: SPRITE_SIZE * 0.78,
                  height: SPRITE_SIZE * 0.78,
                }}
                draggable={false}
              />
            </div>
          </div>
          <div className="mt-1 max-w-[120px] truncate rounded-(--radius-2) bg-(--gray-3) px-2 py-0.5 font-medium text-(--gray-11) text-[11px] shadow-sm">
            Builder
          </div>
        </motion.button>
      </Tooltip>
    </motion.div>
  );
}
