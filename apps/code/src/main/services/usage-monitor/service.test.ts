import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageOutput } from "../llm-gateway/schemas";
import { UsageMonitorEvent } from "./schemas";

const mockStoreGet = vi.hoisted(() => vi.fn());
const mockStoreSet = vi.hoisted(() => vi.fn());

vi.mock("./store", () => ({
  usageMonitorStore: {
    get: mockStoreGet,
    set: mockStoreSet,
  },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import type { LlmGatewayService } from "../llm-gateway/service";
import { UsageMonitorService } from "./service";

function makeUsage(overrides?: {
  burstPercent?: number;
  sustainedPercent?: number;
  billingPeriodEnd?: string | null;
  burstResetAt?: string;
  sustainedResetAt?: string;
}): UsageOutput {
  return {
    product: "posthog_code",
    user_id: 42,
    is_rate_limited: false,
    billing_period_end:
      overrides?.billingPeriodEnd === undefined
        ? null
        : overrides.billingPeriodEnd,
    burst: {
      used_percent: overrides?.burstPercent ?? 0,
      resets_in_seconds: 3600,
      reset_at: overrides?.burstResetAt ?? "2026-05-25T16:00:00.000Z",
      exceeded: false,
    },
    sustained: {
      used_percent: overrides?.sustainedPercent ?? 0,
      resets_in_seconds: 86400,
      reset_at: overrides?.sustainedResetAt ?? "2026-06-01T00:00:00.000Z",
      exceeded: false,
    },
  };
}

function mockGateway(usage: UsageOutput | null): LlmGatewayService {
  return {
    fetchUsage: vi.fn().mockResolvedValue(usage),
  } as unknown as LlmGatewayService;
}

describe("UsageMonitorService", () => {
  let service: UsageMonitorService;
  let persisted: Record<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));
    persisted = {};
    mockStoreGet.mockImplementation((_key: string, fallback: unknown) => ({
      ...persisted,
      ...(fallback as Record<string, string>),
    }));
    mockStoreSet.mockImplementation(
      (_key: string, value: Record<string, string>) => {
        persisted = { ...value };
      },
    );
  });

  afterEach(() => {
    service?.stop();
    vi.useRealTimers();
  });

  it("emits at 75% but not again on the next poll for the same anchor", async () => {
    const events: unknown[] = [];
    const gateway = mockGateway(makeUsage({ burstPercent: 78 }));
    service = new UsageMonitorService(gateway);
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) => events.push(e));

    await service.pollOnce();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      bucket: "burst",
      threshold: 75,
      usedPercent: 78,
    });

    await service.pollOnce();
    expect(events).toHaveLength(1);
  });

  it("only emits the highest threshold a bucket has crossed", async () => {
    const events: unknown[] = [];
    const gateway = mockGateway(makeUsage({ burstPercent: 95 }));
    service = new UsageMonitorService(gateway);
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) => events.push(e));

    await service.pollOnce();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ threshold: 90 });
  });

  it("doesn't re-emit after a relaunch with persisted dedupe", async () => {
    const events: unknown[] = [];
    const gateway = mockGateway(makeUsage({ burstPercent: 55 }));
    service = new UsageMonitorService(gateway);
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) => events.push(e));
    await service.pollOnce();
    expect(events).toHaveLength(1);
    service.stop();

    // Simulate relaunch
    service = new UsageMonitorService(gateway);
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) => events.push(e));
    await service.pollOnce();
    expect(events).toHaveLength(1);
  });

  it("tracks burst and sustained as independent buckets", async () => {
    const events: unknown[] = [];
    const gateway = mockGateway(
      makeUsage({
        burstPercent: 55,
        sustainedPercent: 80,
        billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      }),
    );
    service = new UsageMonitorService(gateway);
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) => events.push(e));

    await service.pollOnce();
    expect(events).toHaveLength(2);
    expect(events.map((e) => (e as { bucket: string }).bucket).sort()).toEqual([
      "burst",
      "sustained",
    ]);
  });

  it("marks events with isPro when billing_period_end is set", async () => {
    const events: { isPro: boolean }[] = [];
    const gateway = mockGateway(
      makeUsage({
        sustainedPercent: 60,
        billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      }),
    );
    service = new UsageMonitorService(gateway);
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) =>
      events.push(e as { isPro: boolean }),
    );

    await service.pollOnce();
    expect(events[0]?.isPro).toBe(true);
  });

  it("silently skips polls when the gateway throws", async () => {
    const events: unknown[] = [];
    const gateway = {
      fetchUsage: vi.fn().mockRejectedValue(new Error("not authenticated")),
    } as unknown as LlmGatewayService;
    service = new UsageMonitorService(gateway);
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) => events.push(e));

    await expect(service.pollOnce()).resolves.toBeNull();
    expect(events).toHaveLength(0);
  });

  it("emits UsageUpdated and caches the snapshot on every successful poll", async () => {
    const updates: UsageOutput[] = [];
    const gateway = mockGateway(makeUsage({ burstPercent: 20 }));
    service = new UsageMonitorService(gateway);
    service.on(UsageMonitorEvent.UsageUpdated, (u) => updates.push(u));

    expect(service.getLatest()).toBeNull();
    await service.pollOnce();
    expect(updates).toHaveLength(1);
    expect(service.getLatest()?.burst.used_percent).toBe(20);

    await service.pollOnce();
    expect(updates).toHaveLength(2);
  });

  it("does not emit UsageUpdated when the gateway throws", async () => {
    const updates: UsageOutput[] = [];
    const gateway = {
      fetchUsage: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as LlmGatewayService;
    service = new UsageMonitorService(gateway);
    service.on(UsageMonitorEvent.UsageUpdated, (u) => updates.push(u));

    await service.pollOnce();
    expect(updates).toHaveLength(0);
    expect(service.getLatest()).toBeNull();
  });

  it("refreshNow triggers a fresh poll and returns the snapshot", async () => {
    const gateway = mockGateway(makeUsage({ burstPercent: 42 }));
    service = new UsageMonitorService(gateway);

    const result = await service.refreshNow();
    expect(result?.burst.used_percent).toBe(42);
    expect(service.getLatest()?.burst.used_percent).toBe(42);
  });
});
