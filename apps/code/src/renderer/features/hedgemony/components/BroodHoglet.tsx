import { useSortable } from "@dnd-kit/react/sortable";
import type { Hoglet } from "@main/services/hedgemony/schemas";
import { Tooltip } from "@radix-ui/themes";
import { motion } from "framer-motion";
import { useHogletVisuals } from "../hooks/useHogletVisuals";
import { nestAccentColor } from "../utils/nestColors";
import { AnimatedHedgehog } from "./AnimatedHedgehog";
import { HogletHammer } from "./HogletHammer";
import { PR_DOT_COLOR } from "./hogletStatus";

const SPRITE_SIZE = 44;

interface BroodHogletProps {
  hoglet: Hoglet;
  nestId: string;
  index: number;
  x: number;
  y: number;
  selected: boolean;
  dimmed?: boolean;
  onSelect: (hogletId: string, additive: boolean) => void;
}

export function BroodHoglet({
  hoglet,
  nestId,
  index,
  x,
  y,
  selected,
  dimmed: dimmedByAffiliation,
  onSelect,
}: BroodHogletProps) {
  const { ref, isDragging } = useSortable({
    id: hoglet.id,
    index,
    group: `nest-${nestId}`,
    data: { type: "hoglet", hogletId: hoglet.id, sourceNestId: nestId },
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
  const accentColor = nestAccentColor(nestId);

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
      <Tooltip
        content={
          hoglet.affinityScore !== null ? (
            <span className="flex flex-col gap-0.5">
              <span>{title}</span>
              <span className="text-(--gray-9) text-[11px]">
                Auto-routed (similarity {hoglet.affinityScore.toFixed(2)})
              </span>
            </span>
          ) : (
            title
          )
        }
        side="bottom"
      >
        <button
          ref={ref}
          type="button"
          data-hedgemony-hoglet
          aria-label={`Hoglet: ${title}`}
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
            {status === "in_progress" && (
              <span className="-bottom-1 absolute left-0">
                <HogletHammer size={18} />
              </span>
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
            <div className="mt-1 flex max-w-[100px] items-center gap-1 rounded-(--radius-2) bg-(--gray-3) px-2 py-0.5 font-medium text-(--gray-11) text-[11px] shadow-sm">
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: accentColor }}
              />
              <span className="truncate">{hoglet.name}</span>
            </div>
          )}
        </button>
      </Tooltip>
    </motion.div>
  );
}
