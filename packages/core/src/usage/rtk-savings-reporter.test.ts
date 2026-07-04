import type { RootLogger } from "@posthog/di/logger";
import type { IAnalytics } from "@posthog/platform/analytics";
import type { IAppLifecycle } from "@posthog/platform/app-lifecycle";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RtkSavingsGauge } from "./identifiers";
import { RtkSavingsReporter } from "./rtk-savings-reporter";

const DAY_MS = 24 * 60 * 60 * 1000;

const GAUGE: RtkSavingsGauge = {
  counterId: "machine-1",
  totalCommands: 4,
  inputTokens: 1000,
  outputTokens: 350,
  tokensSaved: 650,
};

function makeReporter(readGauge: () => Promise<RtkSavingsGauge | null>) {
  const track = vi.fn();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const reporter = new RtkSavingsReporter(
    { readGauge },
    // The service only uses these slices of the injected interfaces.
    { track } as unknown as IAnalytics,
    { whenReady: () => Promise.resolve() } as unknown as IAppLifecycle,
    { scope: () => logger } as unknown as RootLogger,
  );
  return { reporter, track };
}

describe("RtkSavingsReporter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the gauge on start and daily thereafter when the reading moves", async () => {
    let tokensSaved = 650;
    const { reporter, track } = makeReporter(async () => ({
      ...GAUGE,
      tokensSaved,
    }));

    reporter.init();
    await vi.advanceTimersByTimeAsync(0);

    expect(track).toHaveBeenCalledExactlyOnceWith(
      ANALYTICS_EVENTS.RTK_SAVINGS_GAUGE,
      {
        counter_id: "machine-1",
        cumulative_commands: 4,
        cumulative_input_tokens: 1000,
        cumulative_output_tokens: 350,
        cumulative_tokens_saved: 650,
      },
    );

    tokensSaved = 900;
    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenLastCalledWith(
      ANALYTICS_EVENTS.RTK_SAVINGS_GAUGE,
      expect.objectContaining({ cumulative_tokens_saved: 900 }),
    );
  });

  it("skips the daily report when the reading is unchanged", async () => {
    const { reporter, track } = makeReporter(async () => GAUGE);

    reporter.init();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2 * DAY_MS);

    expect(track).toHaveBeenCalledTimes(1);
  });

  it.each<[string, () => Promise<RtkSavingsGauge | null>]>([
    ["rtk unavailable or nothing tracked", async () => null],
    [
      "reading the gauge throws",
      async () => {
        throw new Error("rtk exploded");
      },
    ],
  ])("reports nothing when %s", async (_case, readGauge) => {
    const { reporter, track } = makeReporter(readGauge);

    reporter.init();
    await vi.advanceTimersByTimeAsync(0);

    expect(track).not.toHaveBeenCalled();
  });

  it("stops the daily timer on dispose", async () => {
    const { reporter, track } = makeReporter(async () => GAUGE);

    reporter.init();
    await vi.advanceTimersByTimeAsync(0);
    reporter.dispose();
    await vi.advanceTimersByTimeAsync(3 * DAY_MS);

    expect(track).toHaveBeenCalledTimes(1);
  });
});
