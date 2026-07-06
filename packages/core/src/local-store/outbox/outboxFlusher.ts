import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import type { OutboxEntry } from "@posthog/platform/local-persistence";
import { inject, injectable } from "inversify";
import type { SyncedEntity } from "../schemas";
import type { ApplyPipeline } from "../sync/applyPipeline";
import { APPLY_PIPELINE } from "../sync/identifiers";
import { OUTBOX } from "./identifiers";
import type { Outbox } from "./outbox";

/** Sends one kind of mutation to the server. Registered per collection+op. */
export interface MutationExecutor {
  readonly collection: string;
  readonly op: string;
  /**
   * Perform the server call. Return the authoritative server row to apply
   * (or null when the op yields none), or "skip" to leave the entry queued
   * (e.g. no authenticated client right now).
   */
  execute(entry: OutboxEntry): Promise<SyncedEntity | null | "skip">;
}

const MAX_ATTEMPTS = 3;
const LEASE_MS = 60_000;
const IDLE_PUMP_MS = 15_000;
const RETRY_DELAYS_MS = [2_000, 10_000, 30_000];

/**
 * Drains the outbox in the leader window: strict per-record FIFO, bounded
 * retries with backoff, park-and-rollback on terminal failure (the queue
 * never wedges behind a poison entry), acknowledged rows applied through
 * the pipeline so pending later edits rebase on top.
 */
@injectable()
export class OutboxFlusher {
  private readonly executors = new Map<string, MutationExecutor>();
  private started = false;
  private pumping = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly log: ScopedLogger;

  constructor(
    @inject(OUTBOX)
    private readonly outbox: Outbox,
    @inject(APPLY_PIPELINE)
    private readonly applyPipeline: ApplyPipeline,
    @inject(ROOT_LOGGER)
    rootLogger: RootLogger,
  ) {
    this.log = rootLogger.scope("local-store:flusher");
  }

  registerExecutor(executor: MutationExecutor): void {
    this.executors.set(`${executor.collection}:${executor.op}`, executor);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.poke();
  }

  stop(): void {
    this.started = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  poke(): void {
    if (!this.started) return;
    this.schedule(0);
  }

  /** Drain everything currently flushable. Exposed for tests and shutdown. */
  async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const entry = this.outbox.nextQueued();
        if (!entry) return;
        const proceed = await this.flushOne(entry);
        if (!proceed) return;
      }
    } finally {
      this.pumping = false;
      if (this.started && this.outbox.queuedCount() > 0) {
        this.schedule(this.retryDelay());
      } else if (this.started) {
        this.schedule(IDLE_PUMP_MS);
      }
    }
  }

  /** Returns false when pumping should pause (skip or retry backoff). */
  private async flushOne(entry: OutboxEntry): Promise<boolean> {
    const executor = this.executors.get(`${entry.collection}:${entry.op}`);
    if (!executor) {
      await this.outbox.park(
        entry,
        `No mutation executor registered for ${entry.collection}:${entry.op}`,
      );
      return true;
    }

    await this.outbox.markExecuting(entry, LEASE_MS);
    try {
      const result = await executor.execute(entry);
      if (result === "skip") {
        await this.outbox.markQueuedForRetry(entry, "skipped: no client");
        entry.attempts -= 1; // Skips are not failures; don't burn attempts.
        return false;
      }
      await this.outbox.complete(entry);
      if (result) {
        this.applyPipeline.applyAcknowledged(entry.collection, result);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (entry.attempts + 1 >= MAX_ATTEMPTS) {
        await this.outbox.park(entry, message);
        return true; // Parked entries no longer block the pump.
      }
      await this.outbox.markQueuedForRetry(entry, message);
      this.log.warn(
        `flush failed for ${entry.collection}/${entry.op} (${entry.attempts}/${MAX_ATTEMPTS}): ${message}`,
      );
      return false; // Back off before retrying.
    }
  }

  private retryDelay(): number {
    const next = this.outbox.nextQueued();
    const attempts = next?.attempts ?? 0;
    return (
      RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)] ?? 30_000
    );
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pump();
    }, delayMs);
  }
}
