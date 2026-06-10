import { useSortable } from "@dnd-kit/react/sortable";
import type { Hoglet } from "@posthog/host-router/rts-schemas";
import { Tooltip } from "@radix-ui/themes";
import { motion } from "framer-motion";
import { useHogletVisuals } from "../hooks/useHogletVisuals";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { wildHogletPosition } from "../utils/hogletPositions";
import { AnimatedHedgehog } from "./AnimatedHedgehog";
import { PR_DOT_COLOR, TASK_STATUS_DOT_COLOR } from "./hogletStatus";

const SPRITE_SIZE = 40;

interface WildHogletProps {
  hoglet: Hoglet;
  index: number;
  selected: boolean;
  dimmed?: boolean;
  onSelect: (hogletId: string, additive: boolean) => void;
}

export function WildHoglet({
  hoglet,
  index,
  selected,
  dimmed: dimmedByAffiliation,
  onSelect,
}: WildHogletProps) {
  const override = useHogletPositionStore((s) => s.positions[hoglet.id]);
  const fallback = wildHogletPosition(hoglet.id);
  const x = override?.x ?? fallback.x;
  const y = override?.y ?? fallback.y;
  const { ref, isDragging } = useSortable({
    id: hoglet.id,
    index,
    group: "wild-flock",
    data: { type: "hoglet", hogletId: hoglet.id, sourceNestId: null },
    transition: { duration: 200, easing: "ease" },
  });

  const {
    motionX,
    motionY,
    facing,
    status,
    animationKey,
    fps,
    prState,
    title,
    cancelled,
  } = useHogletVisuals(hoglet, x, y);

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onSelect(hoglet.id, event.shiftKey || event.metaKey || event.ctrlKey);
  };

  return (
    <motion.div
      className="absolute top-1/2 left-1/2"
      style={{
        x: motionX,
        y: motionY,
        opacity: isDragging
          ? 0.4
          : dimmedByAffiliation
            ? 0.32
            : cancelled
              ? 0.55
              : 1,
      }}
    >
      <Tooltip content={`${title} — drag onto a nest to adopt`} side="bottom">
        <button
          ref={ref}
          type="button"
          data-rts-hoglet
          aria-label={`Wild hoglet: ${title}`}
          aria-pressed={selected}
          onClick={handleClick}
          onContextMenu={(event) => event.preventDefault()}
          className="-translate-x-1/2 -translate-y-1/2 flex cursor-grab flex-col items-center border-0 bg-transparent p-0 active:cursor-grabbing"
        >
          <div className="relative">
            {selected && (
              <span
                aria-hidden
                className="-inset-1.5 absolute rounded-full border-(--accent-9) border-2 bg-(--accent-3)/30 shadow-[0_0_0_2px_var(--accent-4)]"
              />
            )}
            <AnimatedHedgehog
              animation={animationKey}
              fps={fps}
              facing={facing}
              size={SPRITE_SIZE}
            />
            {status && status !== "not_started" && (
              <span
                aria-hidden
                className="absolute bottom-0 left-0 h-3 w-3 rounded-full border border-(--gray-1) shadow"
                style={{ backgroundColor: TASK_STATUS_DOT_COLOR[status] }}
              />
            )}
            {prState && (
              <span
                aria-hidden
                className="absolute right-0 bottom-0 h-3 w-3 rounded-full border border-(--gray-1) shadow"
                style={{ backgroundColor: PR_DOT_COLOR[prState] }}
              />
            )}
          </div>
          {hoglet.name && (
            <div className="mt-1 max-w-[100px] truncate rounded-(--radius-2) bg-(--gray-3) px-2 py-0.5 font-medium text-(--gray-11) text-[11px] shadow-sm">
              {hoglet.name}
            </div>
          )}
        </button>
      </Tooltip>
    </motion.div>
  );
}
