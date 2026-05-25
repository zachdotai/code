import { inject, injectable, postConstruct, preDestroy } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { UsageBucket, UsageOutput } from "../llm-gateway/schemas";
import type { LlmGatewayService } from "../llm-gateway/service";
import {
  USAGE_THRESHOLDS,
  UsageMonitorEvent,
  type UsageMonitorEvents,
  type UsageThreshold,
} from "./schemas";
import { usageMonitorStore } from "./store";

const log = logger.scope("usage-monitor");

const POLL_INTERVAL_MS = 30_000;

type BucketName = "burst" | "sustained";

@injectable()
export class UsageMonitorService extends TypedEventEmitter<UsageMonitorEvents> {
  private pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isPolling = false;
  // Snapshot of the most recent thresholdsSeen map so we hit electron-store
  // only when we actually persist a new threshold.
  private thresholdsSeen: Record<string, string>;
  private latestUsage: UsageOutput | null = null;

  constructor(
    @inject(MAIN_TOKENS.LlmGatewayService)
    private readonly llmGateway: LlmGatewayService,
  ) {
    super();
    this.thresholdsSeen = { ...usageMonitorStore.get("thresholdsSeen", {}) };
  }

  /** Last successful usage snapshot; null until the first poll succeeds. */
  getLatest(): UsageOutput | null {
    return this.latestUsage;
  }

  /** Trigger an immediate refresh, returning the resulting snapshot. */
  async refreshNow(): Promise<UsageOutput | null> {
    return this.pollOnce();
  }

  @postConstruct()
  init(): void {
    this.pruneStaleEntries();
    this.schedulePoll(POLL_INTERVAL_MS);
  }

  @preDestroy()
  stop(): void {
    if (this.pollTimeoutId) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = null;
    }
  }

  // Exposed so tests can drive the loop deterministically.
  async pollOnce(): Promise<UsageOutput | null> {
    if (this.isPolling) return null;
    this.isPolling = true;
    try {
      const usage = await this.fetchUsageQuietly();
      if (usage) {
        this.latestUsage = usage;
        this.emit(UsageMonitorEvent.UsageUpdated, usage);
        this.processUsage(usage);
      }
      return usage;
    } finally {
      this.isPolling = false;
    }
  }

  private async fetchUsageQuietly(): Promise<UsageOutput | null> {
    try {
      return await this.llmGateway.fetchUsage();
    } catch (err) {
      log.debug("Usage poll skipped", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private schedulePoll(delayMs: number): void {
    this.pollTimeoutId = setTimeout(async () => {
      this.pollTimeoutId = null;
      await this.pollOnce();
      this.schedulePoll(POLL_INTERVAL_MS);
    }, delayMs);
  }

  private processUsage(usage: UsageOutput): void {
    const userId = usage.user_id.toString();
    const product = usage.product;
    // Plan-key isn't on UsageOutput; the only signal we have client-side is
    // whether limits are at the Pro tier — but fetchUsage doesn't return that
    // either. Best-effort: assume Pro if billing_period_end is present
    // (free users never have it).
    const isPro = !!usage.billing_period_end;

    this.maybeEmit(usage, "burst", usage.burst, userId, product, isPro);
    this.maybeEmit(usage, "sustained", usage.sustained, userId, product, isPro);
  }

  private maybeEmit(
    usage: UsageOutput,
    bucket: BucketName,
    status: UsageBucket,
    userId: string,
    product: string,
    isPro: boolean,
  ): void {
    const anchor = this.anchorFor(bucket, status, usage);
    if (!anchor) return;

    const threshold = highestThresholdCrossed(status.used_percent);
    if (threshold === null) return;

    const key = makeKey(userId, product, bucket, anchor, threshold);
    if (this.thresholdsSeen[key]) return;

    this.thresholdsSeen[key] = anchor;
    usageMonitorStore.set("thresholdsSeen", this.thresholdsSeen);

    log.info("Usage threshold crossed", {
      bucket,
      threshold,
      usedPercent: status.used_percent,
    });

    this.emit(UsageMonitorEvent.ThresholdCrossed, {
      bucket,
      threshold,
      usedPercent: status.used_percent,
      resetAt: status.reset_at ?? null,
      resetsInSeconds: status.resets_in_seconds,
      isPro,
    });
  }

  // Burst anchor rounds reset_at to the hour so transient TTL jitter doesn't
  // make every poll look like a new window. Sustained anchor is the billing
  // period end (Pro) or the reset_at ISO date (free).
  private anchorFor(
    bucket: BucketName,
    status: UsageBucket,
    usage: UsageOutput,
  ): string | null {
    if (bucket === "sustained") {
      return usage.billing_period_end ?? sustainedFreeAnchor(status) ?? null;
    }
    return burstAnchor(status);
  }

  private pruneStaleEntries(): void {
    const now = Date.now();
    let dirty = false;
    for (const [key, anchor] of Object.entries(this.thresholdsSeen)) {
      const parsed = Date.parse(anchor);
      if (Number.isNaN(parsed) || parsed < now) {
        delete this.thresholdsSeen[key];
        dirty = true;
      }
    }
    if (dirty) {
      usageMonitorStore.set("thresholdsSeen", this.thresholdsSeen);
    }
  }
}

function highestThresholdCrossed(usedPercent: number): UsageThreshold | null {
  for (let i = USAGE_THRESHOLDS.length - 1; i >= 0; i--) {
    const t = USAGE_THRESHOLDS[i];
    if (usedPercent >= t) return t;
  }
  return null;
}

function burstAnchor(status: UsageBucket): string | null {
  const resetMs = resetMillis(status);
  if (resetMs === null) return null;
  // Round to the nearest hour so 30s polling doesn't churn the anchor.
  const rounded = Math.round(resetMs / 3_600_000) * 3_600_000;
  return new Date(rounded).toISOString();
}

function sustainedFreeAnchor(status: UsageBucket): string | null {
  const resetMs = resetMillis(status);
  if (resetMs === null) return null;
  return new Date(resetMs).toISOString().slice(0, 10);
}

function resetMillis(status: UsageBucket): number | null {
  if (status.reset_at) {
    const parsed = Date.parse(status.reset_at);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (status.resets_in_seconds > 0) {
    return Date.now() + status.resets_in_seconds * 1000;
  }
  return null;
}

function makeKey(
  userId: string,
  product: string,
  bucket: BucketName,
  anchor: string,
  threshold: UsageThreshold,
): string {
  return `${userId}:${product}:${bucket}:${anchor}:${threshold}`;
}
