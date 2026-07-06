import type { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import { ENTITY_REGISTRY } from "@posthog/core/local-store/identifiers";
import type { SyncedEntity } from "@posthog/core/local-store/schemas";
import { SYNC_ENGINE } from "@posthog/core/local-store/sync/identifiers";
import type { SyncEngine } from "@posthog/core/local-store/sync/syncEngine";
import {
  addActiveThread,
  removeActiveThread,
  TASK_THREADS_COLLECTION,
} from "@posthog/core/tasks/taskSync";
import { useService } from "@posthog/di/react";
import type { TaskThreadMessage } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

export function taskThreadQueryKey(taskId: string | undefined) {
  return ["task-thread", taskId ?? "none"] as const;
}

const EMPTY_MESSAGES: TaskThreadMessage[] = [];

/**
 * A task's thread — the human side conversation — in chronological order.
 * Local-first: messages render from the synced task_threads pool (instant on
 * reopen); mounting registers the task so the engine pulls it on the fast
 * cadence — one centralized loop instead of a poll per feed row.
 */
export function useTaskThread(
  taskId: string | undefined,
  _options?: {
    /** Ignored: freshness is owned by the sync engine's thread cadence. */
    pollIntervalMs?: number;
  },
): {
  messages: TaskThreadMessage[];
  isLoading: boolean;
} {
  const registry = useService<EntityRegistry>(ENTITY_REGISTRY);
  const engine = useService<SyncEngine>(SYNC_ENGINE);

  useEffect(() => {
    if (!taskId) return;
    addActiveThread(taskId);
    engine.poke(TASK_THREADS_COLLECTION);
    return () => removeActiveThread(taskId);
  }, [taskId, engine]);

  const pool = useMemo(
    () => registry.getPool<SyncedEntity>(TASK_THREADS_COLLECTION),
    [registry],
  );

  const messages = useStore(
    pool.store,
    useShallow((state) => {
      if (!taskId) return EMPTY_MESSAGES;
      const row = state.entities[taskId] as
        | { messages?: TaskThreadMessage[] }
        | undefined;
      return row?.messages ?? EMPTY_MESSAGES;
    }),
  );
  const hasRow = useStore(pool.store, (state) =>
    taskId ? state.entities[taskId] !== undefined : false,
  );

  return { messages, isLoading: !!taskId && !hasRow };
}

export function useTaskThreadMutations(taskId: string | undefined) {
  const client = useOptionalAuthenticatedClient();
  const engine = useService<SyncEngine>(SYNC_ENGINE);

  // Thread writes await the server (they're panel interactions, not bulk
  // edits); the poke pulls the authoritative thread straight into the pool.
  const refresh = useCallback(() => {
    engine.poke(TASK_THREADS_COLLECTION);
  }, [engine]);

  const postMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!client || !taskId) throw new Error("Not authenticated");
      return client.createTaskThreadMessage(taskId, content);
    },
    onSuccess: refresh,
  });

  const deleteMutation = useMutation({
    mutationFn: async (messageId: string) => {
      if (!client || !taskId) throw new Error("Not authenticated");
      return client.deleteTaskThreadMessage(taskId, messageId);
    },
    onSuccess: refresh,
  });

  const sendToAgentMutation = useMutation({
    mutationFn: async (messageId: string) => {
      if (!client || !taskId) throw new Error("Not authenticated");
      return client.sendTaskThreadMessageToAgent(taskId, messageId);
    },
    onSuccess: refresh,
  });

  return {
    postMessage: (content: string) => postMutation.mutateAsync(content),
    deleteMessage: (messageId: string) => deleteMutation.mutateAsync(messageId),
    sendToAgent: (messageId: string) =>
      sendToAgentMutation.mutateAsync(messageId),
    isPosting: postMutation.isPending,
    isSendingToAgent: sendToAgentMutation.isPending,
  };
}
