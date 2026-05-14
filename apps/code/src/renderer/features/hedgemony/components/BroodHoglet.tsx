import { useSortable } from "@dnd-kit/react/sortable";
import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import type { Hoglet } from "@main/services/hedgemony/schemas";
import { Tooltip } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import type { Task } from "@shared/types";
import { useNavigationStore } from "@stores/navigationStore";
import { useQuery } from "@tanstack/react-query";
import { logger } from "@utils/logger";
import { motion } from "framer-motion";
import { selectTaskSummary, useHogletStore } from "../stores/hogletStore";
import { AnimatedHedgehog } from "./AnimatedHedgehog";
import { HogletHammer } from "./HogletHammer";
import {
  ANIMATION_BY_TASK_STATUS,
  ANIMATION_BY_TASK_STATUS_ROBO,
  FPS_BY_TASK_STATUS,
  PR_DOT_COLOR,
  type TaskStatus,
} from "./hogletStatus";

const log = logger.scope("brood-hoglet");

const SPRITE_SIZE = 44;

interface BroodHogletProps {
  hoglet: Hoglet;
  nestId: string;
  index: number;
  x: number;
  y: number;
}

export function BroodHoglet({ hoglet, nestId, index, x, y }: BroodHogletProps) {
  const summary = useHogletStore(selectTaskSummary(hoglet.taskId));
  const trpc = useTRPC();
  const navigateToTask = useNavigationStore((s) => s.navigateToTask);

  const { ref, isDragging } = useSortable({
    id: hoglet.id,
    index,
    group: `nest-${nestId}`,
    data: { type: "hoglet", hogletId: hoglet.id, sourceNestId: nestId },
    transition: { duration: 200, easing: "ease" },
  });

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
  const animationKey = animationMap[status ?? "not_started"];
  const fps = FPS_BY_TASK_STATUS[status ?? "not_started"];
  const dimmed = status === "cancelled";

  const handleClick = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const client = await getAuthenticatedClient();
      if (!client) return;
      const task = (await client.getTask(hoglet.taskId)) as Task;
      navigateToTask(task);
    } catch (error) {
      log.error("Failed to open task", { taskId: hoglet.taskId, error });
    }
  };

  return (
    <motion.div
      className="absolute top-1/2 left-1/2"
      initial={false}
      animate={{ x, y }}
      transition={{ type: "spring", damping: 22, stiffness: 220, mass: 0.5 }}
      style={{ opacity: isDragging ? 0.4 : dimmed ? 0.55 : 1 }}
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
          data-hedgemony-nest
          aria-label={`Hoglet: ${title}`}
          onClick={handleClick}
          onContextMenu={(event) => event.preventDefault()}
          className="-translate-x-1/2 -translate-y-1/2 flex cursor-grab flex-col items-center border-0 bg-transparent p-0 active:cursor-grabbing"
        >
          <div className="relative">
            <AnimatedHedgehog
              animation={animationKey}
              fps={fps}
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
        </button>
      </Tooltip>
    </motion.div>
  );
}
