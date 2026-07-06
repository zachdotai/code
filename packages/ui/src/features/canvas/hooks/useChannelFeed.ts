import type { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import { ENTITY_REGISTRY } from "@posthog/core/local-store/identifiers";
import type { SyncedEntity } from "@posthog/core/local-store/schemas";
import { SYNC_ENGINE } from "@posthog/core/local-store/sync/identifiers";
import type { SyncEngine } from "@posthog/core/local-store/sync/syncEngine";
import {
  addActiveChannel,
  CHANNEL_FEEDS_COLLECTION,
  removeActiveChannel,
  TASKS_COLLECTION,
} from "@posthog/core/tasks/taskSync";
import { useService } from "@posthog/di/react";
import type { Task } from "@posthog/shared/domain-types";
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

export function channelFeedQueryKey(channelId: string | undefined) {
  return ["channel-feed", channelId ?? "none"] as const;
}

/**
 * A channel's task feed, oldest first (Slack ordering — the composer sits at
 * the bottom and new cards land above it). Local-first: cards render from the
 * task pool via the channel's synced membership row; while the feed is open
 * the sync engine pulls its channel window on the fast cadence.
 */
export function useChannelFeed(channelId: string | undefined): {
  tasks: Task[];
  isLoading: boolean;
} {
  const registry = useService<EntityRegistry>(ENTITY_REGISTRY);
  const engine = useService<SyncEngine>(SYNC_ENGINE);

  useEffect(() => {
    if (!channelId) return;
    addActiveChannel(channelId);
    engine.poke(TASKS_COLLECTION);
    return () => removeActiveChannel(channelId);
  }, [channelId, engine]);

  const feedsPool = useMemo(
    () => registry.getPool<SyncedEntity>(CHANNEL_FEEDS_COLLECTION),
    [registry],
  );
  const tasksPool = useMemo(
    () => registry.getPool<SyncedEntity>(TASKS_COLLECTION),
    [registry],
  );

  const memberIds = useStore(
    feedsPool.store,
    useShallow((state) => {
      if (!channelId) return [] as string[];
      const row = state.entities[channelId] as
        | { task_ids?: string[] }
        | undefined;
      return row?.task_ids ?? [];
    }),
  );

  const tasks = useStore(
    tasksPool.store,
    useShallow((state) => {
      const rows: Task[] = [];
      for (const id of memberIds) {
        const task = state.entities[id] as unknown as Task | undefined;
        if (task) rows.push(task);
      }
      rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return rows;
    }),
  );

  const hydrated = useStore(feedsPool.store, (state) => state.hydrated);

  return { tasks, isLoading: !hydrated && tasks.length === 0 };
}
