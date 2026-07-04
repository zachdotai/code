import { ROOT_LOGGER, type RootLogger } from "@posthog/di/logger";
import {
  ANALYTICS_SERVICE,
  type IAnalytics,
} from "@posthog/platform/analytics";
import {
  APP_LIFECYCLE_SERVICE,
  type IAppLifecycle,
} from "@posthog/platform/app-lifecycle";
import {
  ANALYTICS_EVENTS,
  type RtkSavingsGaugeProperties,
} from "@posthog/shared/analytics-events";
import { inject, injectable, postConstruct, preDestroy } from "inversify";
import { RTK_SAVINGS_HOST, type RtkSavingsHost } from "./identifiers";

/**
 * Periodically reports rtk's cumulative token-savings counter as a gauge
 * snapshot, mirroring the cloud agent's `_posthog/rtk_savings` event shape
 * (see emitRtkSavings in @posthog/agent's agent-server): `cumulative_*`
 * counter reads grouped by `counter_id`, differenced by consumers rather than
 * summed, so overlapping sessions and re-reads dedupe instead of
 * double-counting.
 *
 * Cadence is app start plus once a day while running — desktop sessions live
 * for days, so a quit hook alone would never report. A reading missed at
 * shutdown is not lost: the counter is cumulative, and the next start reads
 * it. Unchanged readings are skipped, so an idle app emits nothing.
 */
@injectable()
export class RtkSavingsReporter {
  private static readonly REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;

  private readonly logger;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastReading: string | null = null;
  private disposed = false;

  constructor(
    @inject(RTK_SAVINGS_HOST) private readonly host: RtkSavingsHost,
    @inject(ANALYTICS_SERVICE) private readonly analytics: IAnalytics,
    @inject(APP_LIFECYCLE_SERVICE)
    private readonly appLifecycle: IAppLifecycle,
    @inject(ROOT_LOGGER) rootLogger: RootLogger,
  ) {
    this.logger = rootLogger.scope("rtk-savings-reporter");
  }

  @postConstruct()
  init(): void {
    this.appLifecycle
      .whenReady()
      .then(() => {
        // Disposed while waiting for ready — don't start a timer nobody clears.
        if (this.disposed) return;
        void this.report();
        this.intervalId = setInterval(
          () => void this.report(),
          RtkSavingsReporter.REPORT_INTERVAL_MS,
        );
      })
      .catch((error) => {
        this.logger.debug("rtk savings reporting disabled", { error });
      });
  }

  @preDestroy()
  dispose(): void {
    this.disposed = true;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Best-effort: reading or reporting the gauge must never disturb the app. */
  async report(): Promise<void> {
    try {
      const gauge = await this.host.readGauge();
      if (!gauge) return;

      const reading = `${gauge.totalCommands}:${gauge.inputTokens}:${gauge.outputTokens}:${gauge.tokensSaved}`;
      if (reading === this.lastReading) return;
      this.lastReading = reading;

      this.analytics.track(ANALYTICS_EVENTS.RTK_SAVINGS_GAUGE, {
        counter_id: gauge.counterId,
        cumulative_commands: gauge.totalCommands,
        cumulative_input_tokens: gauge.inputTokens,
        cumulative_output_tokens: gauge.outputTokens,
        cumulative_tokens_saved: gauge.tokensSaved,
      } satisfies RtkSavingsGaugeProperties);
      this.logger.debug("Reported rtk savings gauge", { reading });
    } catch (error) {
      this.logger.debug("Failed to report rtk savings gauge", { error });
    }
  }
}
