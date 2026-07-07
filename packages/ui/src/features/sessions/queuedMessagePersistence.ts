import {
  sessionStore,
  sessionStoreSetters,
} from "@posthog/core/sessions/sessionStore";
import type { QueuedMessage } from "@posthog/shared";
import { logger } from "@posthog/ui/shell/logger";
import { queuedMessageStoreApi } from "./queuedMessageStore";

/**
 * Keeps the durable {@link queuedMessageStoreApi} mirror in sync with each
 * session's in-memory `messageQueue`, and rehydrates persisted follow-ups back
 * into a session's core queue when it (re)appears for a task.
 *
 * A store subscription (rather than wrapping the injected setters) is used so
 * EVERY queue mutation is captured — including the several UI call sites that
 * mutate `sessionStoreSetters` directly (dock remove, steer/queue toggle,
 * cancel-into-editor), which a service-seam wrapper would miss.
 *
 * Per task the flow is: on first observation, reconcile (merge persisted into
 * core, dedup by id) BEFORE mirroring, so a freshly-created empty session can't
 * wipe persisted messages that haven't been seeded yet. After reconciliation,
 * queue changes mirror straight through (including drains → clear). Session
 * removal un-reconciles the task so a later recreation re-seeds from disk.
 */

const log = logger.scope("queued-messages");

const reconciledTasks = new Set<string>();
const lastQueueByTask = new Map<string, QueuedMessage[]>();
let unsubscribe: (() => void) | null = null;

function reconcileTask(taskId: string): void {
  void queuedMessageStoreApi
    .whenHydrated()
    .then(() => {
      const session = sessionStoreSetters.getSessionByTaskId(taskId);
      // The session vanished before hydration completed — leave the persisted
      // queue intact so a later recreation can still seed from it.
      if (!session) {
        return;
      }

      const persisted = queuedMessageStoreApi.get(taskId);
      const current = session.messageQueue;
      const existingIds = new Set(current.map((m) => m.id));
      const missing = persisted.filter((m) => !existingIds.has(m.id));

      if (missing.length > 0) {
        // Persisted follow-ups predate anything typed this session, so they
        // belong at the head. The resulting store change re-enters the
        // subscription (now reconciled) and mirrors the merged queue.
        log.info("Rehydrating persisted queued messages", {
          taskId,
          count: missing.length,
        });
        sessionStoreSetters.prependQueuedMessages(taskId, missing);
        return;
      }

      // Nothing to seed: make the mirror match the current queue.
      lastQueueByTask.set(taskId, current);
      queuedMessageStoreApi.set(taskId, current);
    })
    .catch((error) => {
      log.warn("Failed to reconcile persisted queued messages", {
        taskId,
        error,
      });
    });
}

function handleSession(taskId: string, queue: QueuedMessage[]): void {
  if (!reconciledTasks.has(taskId)) {
    // Mark eagerly so repeat observations before the async reconcile finishes
    // don't schedule it twice.
    reconciledTasks.add(taskId);
    lastQueueByTask.set(taskId, queue);
    reconcileTask(taskId);
    return;
  }

  if (lastQueueByTask.get(taskId) === queue) {
    return;
  }
  lastQueueByTask.set(taskId, queue);
  queuedMessageStoreApi.set(taskId, queue);
}

/**
 * Starts mirroring the core session store into the durable queue store. Safe to
 * call repeatedly; only the first call installs the subscription.
 */
export function startQueuedMessagePersistence(): void {
  if (unsubscribe) {
    return;
  }
  unsubscribe = sessionStore.subscribe((state) => {
    const present = new Set<string>();
    for (const session of Object.values(state.sessions)) {
      present.add(session.taskId);
      handleSession(session.taskId, session.messageQueue);
    }
    // A removed/evicted session un-reconciles its task so a later recreation
    // re-seeds from disk instead of mirroring its empty starting queue.
    for (const taskId of [...reconciledTasks]) {
      if (!present.has(taskId)) {
        reconciledTasks.delete(taskId);
        lastQueueByTask.delete(taskId);
      }
    }
  });
}

/**
 * Drops all in-memory tracking. Pairs with `queuedMessageStoreApi.clearAll()` on
 * logout / project switch so tracking doesn't leak across accounts.
 */
export function resetQueuedMessagePersistenceTracking(): void {
  reconciledTasks.clear();
  lastQueueByTask.clear();
}
