import { useSortable } from "@dnd-kit/react/sortable";
import type { Hoglet } from "@main/services/hedgemony/schemas";
import { Tooltip } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useTransitPath } from "../hooks/useTransitPath";
import { useWalkTo } from "../hooks/useWalkTo";
import {
  selectHogletWalkPath,
  useHogletPositionStore,
} from "../stores/hogletPositionStore";
import { selectTaskSummary, useHogletStore } from "../stores/hogletStore";
import { useRegisterHogletVisualPosition } from "../utils/hogletVisualPositions";
import { nestAccentColor } from "../utils/nestColors";
import { HOGLET_RADIUS } from "../utils/worldObstacles";
import { AnimatedHedgehog } from "./AnimatedHedgehog";
import { HogletHammer } from "./HogletHammer";
import {
  ANIMATION_BY_TASK_STATUS,
  ANIMATION_BY_TASK_STATUS_ROBO,
  FPS_BY_TASK_STATUS,
  PR_DOT_COLOR,
  type TaskStatus,
} from "./hogletStatus";

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
  const summary = useHogletStore(selectTaskSummary(hoglet.taskId));
  const trpc = useTRPC();

  const { ref, isDragging } = useSortable({
    id: hoglet.id,
    index,
    group: `nest-${nestId}`,
    data: { type: "hoglet", hogletId: hoglet.id, sourceNestId: nestId },
    transition: { duration: 200, easing: "ease" },
  });

  const walkPath = useHogletPositionStore(selectHogletWalkPath(hoglet.id));
  const computedPath = useTransitPath(
    x,
    y,
    HOGLET_RADIUS,
    walkPath === undefined,
    hoglet.id,
  );
  const { motionX, motionY, isWalking, facing } = useWalkTo(
    x,
    y,
    walkPath ?? computedPath,
  );
  useRegisterHogletVisualPosition(hoglet.id, motionX, motionY);

  const prStatusQuery = useQuery(
    trpc.workspace.getTaskPrStatus.queryOptions(
      { taskId: hoglet.taskId, cloudPrUrl: null },
      { staleTime: 30_000 },
    ),
  );

  const status: TaskStatus = (summary?.latest_run?.status ??
    "not_started") as TaskStatus;
  const title = summary?.title ?? hoglet.taskId.slice(0, 8);
  const prState = prStatusQuery.data?.prState ?? null;
  const animationMap =
    hoglet.signalReportId !== null
      ? ANIMATION_BY_TASK_STATUS_ROBO
      : ANIMATION_BY_TASK_STATUS;
  const statusAnimationKey = animationMap[status ?? "not_started"];
  const animationKey = isWalking
    ? hoglet.signalReportId !== null
      ? "walkRobo"
      : "walk"
    : statusAnimationKey;
  const fps = isWalking ? 14 : FPS_BY_TASK_STATUS[status ?? "not_started"];
  const cancelled = status === "cancelled";
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
