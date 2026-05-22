import {
  CheckCircle,
  Circle,
  HandPalm,
  Lightning,
  XCircle,
} from "@phosphor-icons/react";
import type { TaskRunStatus } from "@shared/types";

export const STATUS_GROUP_IDS = {
  active: "status-active",
  needsYou: "status-needs-you",
  idle: "status-idle",
  done: "status-done",
  failed: "status-failed",
} as const;

export type StatusGroupId =
  (typeof STATUS_GROUP_IDS)[keyof typeof STATUS_GROUP_IDS];

export interface StatusGroupableTask {
  isGenerating?: boolean;
  needsPermission?: boolean;
  taskRunStatus?: TaskRunStatus;
}

export interface StatusTaskGroup<T> {
  id: StatusGroupId;
  name: string;
  tasks: T[];
}

interface StatusBucket {
  id: StatusGroupId;
  name: string;
  predicate: (task: StatusGroupableTask) => boolean;
}

// Order here is the display order AND the matching precedence — a task lands
// in the first bucket whose predicate matches. So a task that's both
// in_progress AND needs permission shows up under "Needs you".
const STATUS_BUCKETS: StatusBucket[] = [
  {
    id: STATUS_GROUP_IDS.needsYou,
    name: "Needs you",
    predicate: (task) => Boolean(task.needsPermission),
  },
  {
    id: STATUS_GROUP_IDS.active,
    name: "Active",
    predicate: (task) =>
      Boolean(task.isGenerating) ||
      task.taskRunStatus === "queued" ||
      task.taskRunStatus === "in_progress",
  },
  {
    id: STATUS_GROUP_IDS.done,
    name: "Done",
    predicate: (task) => task.taskRunStatus === "completed",
  },
  {
    id: STATUS_GROUP_IDS.failed,
    name: "Failed",
    predicate: (task) =>
      task.taskRunStatus === "failed" || task.taskRunStatus === "cancelled",
  },
  {
    id: STATUS_GROUP_IDS.idle,
    name: "Idle",
    predicate: () => true,
  },
];

export const STATUS_GROUP_META: Record<
  StatusGroupId,
  { icon: typeof Lightning; color: string; description: string }
> = {
  [STATUS_GROUP_IDS.active]: {
    icon: Lightning,
    color: "var(--accent-11)",
    description: "Running now",
  },
  [STATUS_GROUP_IDS.needsYou]: {
    icon: HandPalm,
    color: "var(--blue-11)",
    description: "Tasks waiting on your input",
  },
  [STATUS_GROUP_IDS.idle]: {
    icon: Circle,
    color: "var(--gray-10)",
    description: "Not started",
  },
  [STATUS_GROUP_IDS.done]: {
    icon: CheckCircle,
    color: "var(--green-11)",
    description: "Completed runs",
  },
  [STATUS_GROUP_IDS.failed]: {
    icon: XCircle,
    color: "var(--red-11)",
    description: "Failed or cancelled runs",
  },
};

export function groupByStatus<T extends StatusGroupableTask>(
  tasks: T[],
): StatusTaskGroup<T>[] {
  const groupMap = new Map<StatusGroupId, StatusTaskGroup<T>>();

  for (const task of tasks) {
    const bucket = STATUS_BUCKETS.find((b) => b.predicate(task));
    if (!bucket) continue;
    let group = groupMap.get(bucket.id);
    if (!group) {
      group = { id: bucket.id, name: bucket.name, tasks: [] };
      groupMap.set(bucket.id, group);
    }
    group.tasks.push(task);
  }

  return STATUS_BUCKETS.map((bucket) => groupMap.get(bucket.id)).filter(
    (group): group is StatusTaskGroup<T> => group !== undefined,
  );
}
