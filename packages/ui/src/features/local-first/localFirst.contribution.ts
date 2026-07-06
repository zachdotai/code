import type { AuthState } from "@posthog/core/auth/schemas";
import type { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import { ENTITY_REGISTRY } from "@posthog/core/local-store/identifiers";
import { OUTBOX } from "@posthog/core/local-store/outbox/identifiers";
import type { Outbox } from "@posthog/core/local-store/outbox/outbox";
import {
  type CloudClientProvider,
  SYNC_CLOUD_CLIENT_PROVIDER,
  SYNC_ENGINE,
} from "@posthog/core/local-store/sync/identifiers";
import type { SyncEngine } from "@posthog/core/local-store/sync/syncEngine";
import {
  TASK_PR_STATUS_CLIENT,
  type TaskPrStatusClient,
} from "@posthog/core/tasks/taskSync";
import { registerTaskSync } from "@posthog/core/tasks/taskSyncSetup";
import type { Contribution } from "@posthog/di/contribution";
import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import { inject, injectable } from "inversify";
import {
  clearAuthSnapshot,
  loadAuthSnapshot,
  saveAuthSnapshot,
} from "../auth/authSnapshot";
import { useAuthStore } from "../auth/store";
import { clearTokenCache } from "../auth/tokenCache";

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
  /** Namespace of the last authenticated session — wiped on logout. */
  private lastNamespace: { userId: string; projectId: number } | null = null;

  constructor(
    @inject(SYNC_ENGINE)
    private readonly engine: SyncEngine,
    @inject(ENTITY_REGISTRY)
    private readonly registry: EntityRegistry,
    @inject(SYNC_CLOUD_CLIENT_PROVIDER)
    private readonly clientProvider: CloudClientProvider,
    @inject(OUTBOX)
    private readonly outbox: Outbox,
    @inject(TASK_PR_STATUS_CLIENT)
    private readonly prStatusClient: TaskPrStatusClient,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    this.log = rootLogger.scope("local-first");
  }

  start(): void {
    registerTaskSync(
      this.registry,
      this.engine,
      this.clientProvider,
      this.prStatusClient,
    );

    this.outbox.events.on("parked", ({ entry, error }) => {
      this.log.warn(`write parked (${entry.collection}/${entry.op})`, error);
      void import("../../primitives/toast").then(({ toast }) => {
        toast.error("A change couldn't be saved", {
          description: "The change was rolled back. Please try again.",
        });
      });
    });

    // Instant boot: restore the last-known auth state so the shell (and the
    // pools hydrating beneath it) render before the real auth check finishes.
    // This runs during boot(), ahead of the first React paint.
    const initial = useAuthStore.getState().authState;
    if (!initial.bootstrapComplete && initial.status === "anonymous") {
      const snapshot = loadAuthSnapshot();
      if (snapshot) {
        this.log.info("restored auth snapshot for instant boot");
        useAuthStore.getState().setAuthState(snapshot);
      }
    }

    this.apply(useAuthStore.getState().authState);
    useAuthStore.subscribe((state) => {
      clearTokenCache();
      this.apply(state.authState);
    });
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
      this.lastNamespace = namespace;
      saveAuthSnapshot(authState);
      this.enqueue(() => this.engine.start(namespace));
    } else if (
      authState.status === "anonymous" &&
      authState.bootstrapComplete
    ) {
      // Definitive logout: stop the engine and destroy this identity's local
      // data (never leak tasks across accounts on a shared machine).
      const namespaceToWipe = this.lastNamespace;
      this.lastNamespace = null;
      clearAuthSnapshot();
      this.enqueue(async () => {
        if (namespaceToWipe) {
          await this.engine.wipe(namespaceToWipe);
        } else {
          await this.engine.stop();
        }
      });
    }
    // Transitional states (mid-refresh, mid-login) leave the engine as-is.
  }

  private enqueue(action: () => Promise<void>): void {
    this.transition = this.transition
      .then(action)
      .catch((error) => this.log.error("engine transition failed", error));
  }
}
