import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import {
  CROSS_WINDOW_CHANNEL,
  type CrossWindowChannel,
  type CrossWindowConnection,
} from "@posthog/platform/cross-window-channel";
import {
  LEADER_ELECTION,
  type LeaderElection,
} from "@posthog/platform/leader-election";
import { inject, injectable } from "inversify";
import { z } from "zod";
import { LOCAL_STORE_SERVICE } from "../identifiers";
import type { LocalStoreService } from "../localStoreService";
import { OUTBOX, OUTBOX_FLUSHER } from "../outbox/identifiers";
import type { Outbox } from "../outbox/outbox";
import type { MutationExecutor, OutboxFlusher } from "../outbox/outboxFlusher";
import {
  buildNamespace,
  type LocalStoreNamespaceInput,
  type SyncedEntity,
} from "../schemas";
import type { AppliedDelta, ApplyPipeline } from "./applyPipeline";
import type { DeltaSource } from "./deltaSource";
import { APPLY_PIPELINE, SYNC_SCHEDULER } from "./identifiers";
import type { SyncScheduler } from "./syncScheduler";
import { syncStatusSetters } from "./syncStatusStore";

const broadcastMessageSchema = z.union([
  z.object({
    type: z.literal("delta"),
    collection: z.string(),
    upserts: z.array(z.unknown()),
    deletes: z.array(z.string()),
  }),
  // A follower enqueued a mutation; the leader should flush now.
  z.object({ type: z.literal("outbox-poke") }),
]);

/**
 * Lifecycle orchestrator of the local-first engine for one identity
 * namespace: opens the store, campaigns for cross-window leadership, runs the
 * scheduler as leader, and fans applied deltas out to follower windows (which
 * apply them in-memory only — the leader owns persistence).
 */
@injectable()
export class SyncEngine {
  private currentNamespace: string | null = null;
  private connection: CrossWindowConnection | null = null;
  private unsubscribeChannel: (() => void) | null = null;
  private withdrawCampaign: (() => void) | null = null;
  private isLeader = false;
  private readonly log: ScopedLogger;

  constructor(
    @inject(LOCAL_STORE_SERVICE)
    private readonly localStore: LocalStoreService,
    @inject(SYNC_SCHEDULER)
    private readonly scheduler: SyncScheduler,
    @inject(APPLY_PIPELINE)
    private readonly applyPipeline: ApplyPipeline,
    @inject(OUTBOX)
    private readonly outbox: Outbox,
    @inject(OUTBOX_FLUSHER)
    private readonly flusher: OutboxFlusher,
    @inject(LEADER_ELECTION)
    private readonly leaderElection: LeaderElection,
    @inject(CROSS_WINDOW_CHANNEL)
    private readonly channels: CrossWindowChannel,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    this.log = rootLogger.scope("local-store:engine");
  }

  get namespace(): string | null {
    return this.currentNamespace;
  }

  registerSource(source: DeltaSource<SyncedEntity>): void {
    this.scheduler.register(source);
  }

  registerExecutor(executor: MutationExecutor): void {
    this.flusher.registerExecutor(executor);
  }

  async start(input: LocalStoreNamespaceInput): Promise<void> {
    const namespace = buildNamespace(input);
    if (this.currentNamespace === namespace) return;
    await this.stop();
    this.currentNamespace = namespace;

    await this.localStore.open(input);
    this.applyPipeline.resetHashes();
    this.applyPipeline.setPendingOverlayProvider((collection, recordId) =>
      this.outbox.pendingOverlay(collection, recordId),
    );
    await this.outbox.replayOntoPools();

    const connection = this.channels.open(`posthog-localstore:${namespace}`);
    this.connection = connection;
    this.unsubscribeChannel = connection.subscribe((data) => {
      // BroadcastChannel never echoes to the sender, so anything arriving
      // here came from another window.
      const parsed = broadcastMessageSchema.safeParse(data);
      if (!parsed.success) return;
      if (parsed.data.type === "outbox-poke") {
        if (this.isLeader) this.flusher.poke();
        return;
      }
      if (this.isLeader) return;
      const { type: _type, ...delta } = parsed.data;
      this.applyPipeline.applyBroadcast(delta as AppliedDelta);
    });
    this.scheduler.setDeltaListener((delta) => {
      connection.postMessage({ type: "delta", ...delta });
    });
    this.outbox.events.on("enqueued", this.onEnqueued);

    this.withdrawCampaign = this.leaderElection.campaign(
      `posthog-localstore-leader:${namespace}`,
      (signal) => {
        this.isLeader = true;
        syncStatusSetters.setLeader(true);
        this.log.info(`leadership acquired for ${namespace}`);
        this.scheduler.start();
        this.flusher.start();
        signal.addEventListener("abort", () => {
          this.isLeader = false;
          syncStatusSetters.setLeader(false);
          this.scheduler.stop();
          this.flusher.stop();
        });
      },
    );
  }

  async stop(): Promise<void> {
    if (this.currentNamespace === null) return;
    this.withdrawCampaign?.();
    this.withdrawCampaign = null;
    this.isLeader = false;
    this.scheduler.stop();
    this.flusher.stop();
    this.scheduler.setDeltaListener(null);
    this.applyPipeline.setPendingOverlayProvider(null);
    this.outbox.events.off("enqueued", this.onEnqueued);
    this.outbox.clearMemory();
    this.unsubscribeChannel?.();
    this.unsubscribeChannel = null;
    this.connection?.close();
    this.connection = null;
    await this.localStore.close();
    syncStatusSetters.reset();
    this.currentNamespace = null;
  }

  private readonly onEnqueued = (): void => {
    if (this.isLeader) {
      this.flusher.poke();
    } else {
      // Ask whichever window leads to flush the entry we just persisted.
      this.connection?.postMessage({ type: "outbox-poke" });
    }
  };

  /** Wipe the namespace's local data entirely (logout, identity mismatch). */
  async wipe(input: LocalStoreNamespaceInput): Promise<void> {
    await this.stop();
    await this.localStore.wipeNamespace(input);
  }

  /** Immediate re-pull of every collection (focus, reconnect, manual). */
  pokeAll(): void {
    this.scheduler.pokeAll();
  }

  poke(collection: string): void {
    this.scheduler.poke(collection);
  }
}
