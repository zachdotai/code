import type { AuthState } from "@posthog/core/auth/schemas";
import type { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import { ENTITY_REGISTRY } from "@posthog/core/local-store/identifiers";
import {
  type CloudClientProvider,
  SYNC_CLOUD_CLIENT_PROVIDER,
  SYNC_ENGINE,
} from "@posthog/core/local-store/sync/identifiers";
import type { SyncEngine } from "@posthog/core/local-store/sync/syncEngine";
import { registerTaskSync } from "@posthog/core/tasks/taskSync";
import type { Contribution } from "@posthog/di/contribution";
import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import { inject, injectable } from "inversify";
import { useAuthStore } from "../auth/store";

/**
 * Boots the local-first engine: registers synced collections, then follows
 * auth state — starting the engine (open store, hydrate, campaign leadership,
 * schedule pulls) once authenticated into a project, switching namespaces on
 * identity change, and stopping on logout.
 */
@injectable()
export class LocalFirstBootContribution implements Contribution {
  private readonly log: ScopedLogger;
  /** Serializes start/stop transitions so auth flaps can't interleave them. */
  private transition: Promise<void> = Promise.resolve();

  constructor(
    @inject(SYNC_ENGINE)
    private readonly engine: SyncEngine,
    @inject(ENTITY_REGISTRY)
    private readonly registry: EntityRegistry,
    @inject(SYNC_CLOUD_CLIENT_PROVIDER)
    private readonly clientProvider: CloudClientProvider,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    this.log = rootLogger.scope("local-first");
  }

  start(): void {
    registerTaskSync(this.registry, this.engine, this.clientProvider);

    this.apply(useAuthStore.getState().authState);
    useAuthStore.subscribe((state) => this.apply(state.authState));
  }

  private apply(authState: AuthState): void {
    if (
      authState.status === "authenticated" &&
      authState.cloudRegion !== null &&
      authState.currentProjectId !== null
    ) {
      const namespace = {
        userId: authState.cloudRegion,
        projectId: authState.currentProjectId,
      };
      this.enqueue(() => this.engine.start(namespace));
    } else if (authState.status === "anonymous") {
      this.enqueue(() => this.engine.stop());
    }
    // Transitional states (mid-refresh, mid-login) leave the engine as-is.
  }

  private enqueue(action: () => Promise<void>): void {
    this.transition = this.transition
      .then(action)
      .catch((error) => this.log.error("engine transition failed", error));
  }
}
