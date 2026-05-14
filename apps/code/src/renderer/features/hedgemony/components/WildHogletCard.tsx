import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import type { Hoglet } from "@main/services/hedgemony/schemas";
import { GitPullRequest } from "@phosphor-icons/react";
import { Badge, Flex, Text } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import type { Task } from "@shared/types";
import { useNavigationStore } from "@stores/navigationStore";
import { useQuery } from "@tanstack/react-query";
import { logger } from "@utils/logger";
import { selectTaskSummary, useHogletStore } from "../stores/hogletStore";

const log = logger.scope("wild-hoglet-card");

interface WildHogletCardProps {
  hoglet: Hoglet;
}

type TaskStatus =
  | "not_started"
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | null;

const STATUS_COLOR: Record<
  NonNullable<TaskStatus>,
  "gray" | "blue" | "green" | "red"
> = {
  not_started: "gray",
  queued: "gray",
  in_progress: "blue",
  completed: "green",
  failed: "red",
  cancelled: "gray",
};

const PR_STATE_LABEL: Record<"open" | "draft" | "merged" | "closed", string> = {
  open: "open PR",
  draft: "draft PR",
  merged: "merged",
  closed: "closed",
};

const PR_STATE_COLOR: Record<
  "open" | "draft" | "merged" | "closed",
  "green" | "gray" | "purple" | "red"
> = {
  open: "green",
  draft: "gray",
  merged: "purple",
  closed: "red",
};

export function WildHogletCard({ hoglet }: WildHogletCardProps) {
  const summary = useHogletStore(selectTaskSummary(hoglet.taskId));
  const trpc = useTRPC();
  const navigateToTask = useNavigationStore((s) => s.navigateToTask);

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

  const handleClick = async () => {
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
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full flex-col gap-2 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) p-3 text-left transition-colors hover:bg-(--gray-3)"
    >
      <Text size="2" weight="medium" className="line-clamp-2 text-(--gray-12)">
        {title}
      </Text>
      <Flex align="center" gap="2" wrap="wrap">
        <Badge size="1" color={status ? STATUS_COLOR[status] : "gray"}>
          {status ?? "not_started"}
        </Badge>
        {prState && (
          <Badge size="1" color={PR_STATE_COLOR[prState]}>
            <GitPullRequest size={10} weight="bold" />
            {PR_STATE_LABEL[prState]}
          </Badge>
        )}
      </Flex>
    </button>
  );
}
