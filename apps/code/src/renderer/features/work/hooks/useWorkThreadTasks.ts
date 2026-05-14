import { useTasks } from "@features/tasks/hooks/useTasks";
import { useMeQuery } from "@hooks/useMeQuery";
import type { Task } from "@shared/types";
import { useMemo } from "react";
import { useWorkThreadsStore } from "../stores/workThreadsStore";

// (debug logger removed — filter now uses local workThreadsStore as the
// primary signal so no diagnostic needed.)

/**
 * HACKATHON SHORTCUT — Work-mode thread list.
 *
 * A task is shown in the Work sidebar's Threads section when ANY of:
 *   1. It's in the local `workThreadsStore` — set when the current user
 *      creates a task from `WorkHomePrompt` / `WorkSampleProjects`.
 *      Reliable and instant; doesn't depend on backend marker storage.
 *   2. The current user's uuid is in `task.repository_config.collaborators`
 *      — populated server-side when someone `@`-mentions and PATCHes the
 *      task. This is how shared threads reach the recipient.
 *
 * When the real backend lands (Task.collaborators M2M + endpoint), swap (2)
 * for `task.collaborators.includes(me)` and drop the local store entirely.
 */
export function useWorkThreadTasks() {
  const { data: currentUser } = useMeQuery();
  const query = useTasks({ showAllUsers: true });
  const localThreadIds = useWorkThreadsStore((s) => s.taskIds);

  const sorted = useMemo<Task[]>(() => {
    const tasks = query.data ?? [];
    const myUuid = currentUser?.uuid;
    const localIdSet = new Set(localThreadIds);
    return tasks
      .filter((t) => {
        if (localIdSet.has(t.id)) return true;
        const config = t.repository_config as
          | { collaborators?: unknown }
          | null
          | undefined;
        const collabs = Array.isArray(config?.collaborators)
          ? (config.collaborators as unknown[])
          : [];
        return typeof myUuid === "string" && collabs.includes(myUuid);
      })
      .sort((a, b) => {
        const ta = new Date(a.created_at).getTime();
        const tb = new Date(b.created_at).getTime();
        return tb - ta;
      });
  }, [query.data, currentUser?.uuid, localThreadIds]);

  return { ...query, data: sorted };
}
