import type { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import type { CloudClientProvider } from "@posthog/core/local-store/sync/identifiers";
import type { SyncEngine } from "@posthog/core/local-store/sync/syncEngine";
import { TaskUpdateExecutor } from "./taskMutations";
import {
  channelFeedsEntity,
  type TaskPrStatusClient,
  TaskPrStatusDeltaSource,
  TaskSummariesDeltaSource,
  TasksDeltaSource,
  taskPrStatusEntity,
  taskSummariesEntity,
  tasksEntity,
} from "./taskSync";

/**
 * Registers the task collections, their delta sources, and their mutation
 * executors with the engine. Called once by the host's local-first boot
 * contribution, before the engine starts (registration participates in the
 * schemaHash).
 */
export function registerTaskSync(
  registry: EntityRegistry,
  engine: SyncEngine,
  provider: CloudClientProvider,
  prStatusClient?: TaskPrStatusClient,
): void {
  registry.register(tasksEntity);
  registry.register(taskSummariesEntity);
  registry.register(channelFeedsEntity);
  registry.register(taskPrStatusEntity);
  engine.registerSource(new TasksDeltaSource(provider));
  engine.registerSource(new TaskSummariesDeltaSource(provider, registry));
  if (prStatusClient) {
    engine.registerSource(
      new TaskPrStatusDeltaSource(prStatusClient, registry),
    );
  }
  engine.registerExecutor(new TaskUpdateExecutor(provider));
}
