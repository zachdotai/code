import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import { type EnricherApiConfig, PostHogApi } from "@posthog/enricher";
import {
  APM_STATS_WINDOW,
  type SerializedApmEnrichment,
} from "@posthog/shared";
import { inject, injectable } from "inversify";
import { ENRICHMENT_AUTH } from "../enrichment/identifiers";
import type { EnrichmentAuth } from "../enrichment/ports";

export interface ApmEnrichFileInput {
  filePath: string;
}

// 24h query is ~8s on the hottest traced file; a lower budget silently drops it.
const QUERY_TIMEOUT_MS = 20_000;

function tracingExplorerUrl(host: string, projectId: number): string {
  return `${host.replace(/\/$/, "")}/project/${projectId}/tracing`;
}

@injectable()
export class ApmEnrichmentService {
  private readonly log: ScopedLogger;

  constructor(
    @inject(ENRICHMENT_AUTH) private readonly authService: EnrichmentAuth,
    @inject(ROOT_LOGGER) logger: RootLogger,
  ) {
    this.log = logger.scope("ApmEnrichmentService");
  }

  async enrichFile(
    input: ApmEnrichFileInput,
  ): Promise<SerializedApmEnrichment | null> {
    this.log.debug("[apm] enrichFile", { filePath: input.filePath });
    const config = await this.resolveApiConfig();
    if (!config) return null;

    try {
      const stats = await new PostHogApi(config).getApmLineStats(
        input.filePath,
        { dateFrom: APM_STATS_WINDOW.dateFrom },
      );
      this.log.info("[apm] enriched", {
        filePath: input.filePath,
        host: config.host,
        projectId: config.projectId,
        lines: stats.length,
      });
      return {
        filePath: input.filePath,
        stats,
        tracingUrl: tracingExplorerUrl(config.host, config.projectId),
      };
    } catch (err) {
      this.log.warn("[apm] query failed", {
        filePath: input.filePath,
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private async resolveApiConfig(): Promise<EnricherApiConfig | null> {
    const state = this.authService.getState();
    if (
      state.status !== "authenticated" ||
      !state.projectId ||
      !state.cloudRegion
    ) {
      this.log.info("[apm] auth not ready", {
        status: state.status,
        projectId: state.projectId,
        cloudRegion: state.cloudRegion,
      });
      return null;
    }
    try {
      const auth = await this.authService.getValidAccessToken();
      return {
        apiKey: auth.accessToken,
        host: auth.apiHost,
        projectId: state.projectId,
        timeoutMs: QUERY_TIMEOUT_MS,
      };
    } catch (err) {
      this.log.warn("[apm] failed to resolve access token", {
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
