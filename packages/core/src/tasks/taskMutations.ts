import type { Schemas } from "@posthog/api-client";
import type { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import { ENTITY_REGISTRY } from "@posthog/core/local-store/identifiers";
import { OUTBOX } from "@posthog/core/local-store/outbox/identifiers";
import type { Outbox } from "@posthog/core/local-store/outbox/outbox";
import type { MutationExecutor } from "@posthog/core/local-store/outbox/outboxFlusher";
import type { SyncedEntity } from "@posthog/core/local-store/schemas";
import type { ApplyPipeline } from "@posthog/core/local-store/sync/applyPipeline";
import {
  APPLY_PIPELINE,
  type CloudClientProvider,
  SYNC_CLOUD_CLIENT_PROVIDER,
} from "@posthog/core/local-store/sync/identifiers";
import type { OutboxEntry } from "@posthog/platform/local-persistence";
import type { Task } from "@posthog/shared/domain-types";
import { inject, injectable } from "inversify";
import { TASK_SUMMARIES_COLLECTION, TASKS_COLLECTION } from "./taskSync";

export const TASK_MUTATION_SERVICE = Symbol.for(
  "posthog.core.tasks.taskMutationService",
);

export interface CreateTaskOptions {
  description: string;
  title?: string;
  repository?: string;
  github_integration?: number | null;
}

export interface LocalTaskRemoval {
  /** Restore the optimistic removal (server delete failed). */
  rollback(): void;
  /** Server confirmed the delete: make the removal durable. */
  confirm(): void;
}

/**
 * Local-first task writes: apply to pools in the same tick, queue durably,
 * reconcile with the server in the background. UI code calls these instead of
 * awaiting HTTP mutations.
 */
@injectable()
export class TaskMutationService {
  constructor(
    @inject(ENTITY_REGISTRY)
    private readonly registry: EntityRegistry,
    @inject(OUTBOX)
    private readonly outbox: Outbox,
    @inject(APPLY_PIPELINE)
    private readonly applyPipeline: ApplyPipeline,
    @inject(SYNC_CLOUD_CLIENT_PROVIDER)
    private readonly clientProvider: CloudClientProvider,
  ) {}

  /**
   * Optimistically patch a task and queue the PATCH. Returns once the write
   * is durable in the outbox — the UI has already updated.
   */
  async updateTask(
    taskId: string,
    updates: Partial<Task> & Record<string, unknown>,
  ): Promise<void> {
    const pool = this.registry.getPool<SyncedEntity>(TASKS_COLLECTION);
    const current = pool.get(taskId);
    const oldValues: Record<string, unknown> = {};
    if (current) {
      for (const key of Object.keys(updates)) {
        oldValues[key] = (current as unknown as Record<string, unknown>)[key];
      }
      pool.applyUpserts([{ ...current, ...updates }], { persist: false });
    }

    if (typeof updates.title === "string") {
      this.overlaySummaryTitle(taskId, updates.title);
    }

    await this.outbox.enqueue({
      collection: TASKS_COLLECTION,
      recordId: taskId,
      op: "update",
      payload: updates,
      oldValues,
    });
  }

  async renameTask(taskId: string, newTitle: string): Promise<void> {
    await this.updateTask(taskId, {
      title: newTitle,
      title_manually_set: true,
    });
  }

  /**
   * Create a task: an optimistic placeholder appears in the same tick; the
   * awaited server row replaces it (creations return the id the UI navigates
   * to, so they resolve against the server rather than queueing).
   */
  async createTask(options: CreateTaskOptions): Promise<Task> {
    const client = this.clientProvider.getClient();
    if (!client) {
      throw new Error("Not authenticated");
    }
    const pool = this.registry.getPool<SyncedEntity>(TASKS_COLLECTION);
    const now = new Date().toISOString();
    const placeholderId = `pending-${globalThis.crypto.randomUUID()}`;
    const placeholder = {
      id: placeholderId,
      title: options.title ?? options.description.slice(0, 80),
      description: options.description,
      repository: options.repository ?? "",
      origin_product: "user_created",
      created_at: now,
      updated_at: now,
    };
    pool.applyUpserts([placeholder], { persist: false });

    try {
      const created = (await client.createTask({
        description: options.description,
        title: options.title,
        repository: options.repository,
        github_integration: options.github_integration,
      })) as unknown as Task & SyncedEntity;
      pool.applyDeletes([placeholderId], { persist: false });
      this.applyPipeline.applyAcknowledged(TASKS_COLLECTION, created);
      return created;
    } catch (error) {
      pool.applyDeletes([placeholderId], { persist: false });
      throw error;
    }
  }

  /**
   * Optimistically remove a task (and its summary) from pools. Deletes await
   * server confirmation before their irreversible local cleanup, so the
   * caller confirms or rolls back explicitly.
   */
  removeTaskLocally(taskId: string): LocalTaskRemoval {
    const tasksPool = this.registry.getPool<SyncedEntity>(TASKS_COLLECTION);
    const summariesPool = this.registry.getPool<SyncedEntity>(
      TASK_SUMMARIES_COLLECTION,
    );
    const task = tasksPool.get(taskId);
    const summary = summariesPool.get(taskId);

    tasksPool.applyDeletes([taskId], { persist: false });
    summariesPool.applyDeletes([taskId], { persist: false });

    return {
      rollback: () => {
        if (task) tasksPool.applyUpserts([task], { persist: false });
        if (summary) summariesPool.applyUpserts([summary], { persist: false });
      },
      confirm: () => {
        // Make the deletion durable in the model tables.
        tasksPool.applyDeletes([taskId]);
        summariesPool.applyDeletes([taskId]);
      },
    };
  }

  private overlaySummaryTitle(taskId: string, title: string): void {
    const summariesPool = this.registry.getPool<SyncedEntity>(
      TASK_SUMMARIES_COLLECTION,
    );
    const summary = summariesPool.get(taskId) as
      | (Schemas.TaskSummary & SyncedEntity)
      | undefined;
    if (summary) {
      summariesPool.applyUpserts([{ ...summary, title } as SyncedEntity], {
        persist: false,
      });
    }
  }
}

/** Flushes queued task PATCHes; the server row acks back through the pipeline. */
export class TaskUpdateExecutor implements MutationExecutor {
  readonly collection = TASKS_COLLECTION;
  readonly op = "update";

  constructor(private readonly provider: CloudClientProvider) {}

  async execute(entry: OutboxEntry): Promise<SyncedEntity | "skip"> {
    const client = this.provider.getClient();
    if (!client) return "skip";
    const row = await client.updateTask(
      entry.recordId,
      entry.payload as Partial<Schemas.Task>,
    );
    return row as unknown as SyncedEntity;
  }
}
