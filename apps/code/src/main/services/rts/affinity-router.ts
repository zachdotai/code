import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type { AuthService } from "../auth/service";
import type { NestService } from "./nest-service";
import type { Nest } from "./schemas";

const log = logger.scope("affinity-router");

/** Cosine similarity floor (0..1). Auto-routing only fires when the best
 *  nest's similarity meets or exceeds this. Override via env var to tune
 *  per-machine without redeploying. */
const DEFAULT_THRESHOLD = 0.65;

interface RouteInput {
  signalReportId: string;
}

interface RouteMatch {
  nestId: string;
  /** Cosine similarity in [0,1]; surfaced to the renderer via the hoglet row. */
  score: number;
}

/**
 * Auto-routes net-new signal-backed hoglets onto active nests using a
 * server-side embedding comparison. The router is consulted by HogletService
 * before insert; failures fall through to the staging area (manual adoption).
 *
 * Embedding plumbing relies on three PostHog primitives:
 *  - the `document_embeddings` ClickHouse table where signal reports are
 *    already embedded by the signals ingestion pipeline,
 *  - the HogQL `embedText(text)` function that produces an embedding on the
 *    fly for ad-hoc text input,
 *  - the `cosineDistance(vec, vec)` HogQL function for nearest-neighbour math.
 *
 * Nest metadata lives in local sqlite, so the router inlines nest IDs +
 * goal text into the HogQL via parameter binding and computes distance for
 * each active nest in a single query. Operator override is naturally honored:
 * routing only runs at ingestion, and `adopt`/`release` clear `affinity_score`
 * to mark current placement as operator-owned.
 */
@injectable()
export class AffinityRouterService {
  private readonly threshold: number;
  private cachedTeamContext: { apiHost: string; teamId: number } | null = null;

  constructor(
    @inject(MAIN_TOKENS.AuthService)
    private readonly auth: AuthService,
    @inject(MAIN_TOKENS.NestService)
    private readonly nests: NestService,
  ) {
    const envValue = process.env.HEDGEMONY_AFFINITY_THRESHOLD;
    const parsed = envValue != null ? Number(envValue) : Number.NaN;
    this.threshold =
      Number.isFinite(parsed) && parsed > 0 && parsed <= 1
        ? parsed
        : DEFAULT_THRESHOLD;
    log.info("Affinity routing configured", {
      threshold: this.threshold,
      thresholdSource: Number.isFinite(parsed) ? "env" : "default",
    });
  }

  async route(input: RouteInput): Promise<RouteMatch | null> {
    const candidates = this.nests
      .list()
      .filter((n) => n.status === "active")
      .map((n) => ({ id: n.id, text: this.buildNestText(n) }))
      .filter((c) => c.text.length > 0);

    if (candidates.length === 0) return null;

    try {
      const { apiHost } = await this.auth.getValidAccessToken();
      const teamId = await this.resolveTeamId(apiHost);
      if (teamId === null) {
        log.warn("Skipping affinity routing — could not resolve team id");
        return null;
      }

      const best = await this.queryBestMatch({
        apiHost,
        teamId,
        signalReportId: input.signalReportId,
        candidates,
      });
      if (best === null) return null;

      // ClickHouse `cosineDistance` returns 1 − cosine_similarity. Invert so
      // the caller can compare to a familiar similarity threshold.
      const score = 1 - best.distance;
      if (score < this.threshold) {
        log.info("Affinity routing skipped — best match below threshold", {
          signalReportId: input.signalReportId,
          bestNestId: best.nestId,
          score,
          threshold: this.threshold,
        });
        return null;
      }

      log.info("Affinity routing matched", {
        signalReportId: input.signalReportId,
        nestId: best.nestId,
        score,
      });
      return { nestId: best.nestId, score };
    } catch (error) {
      log.error("Affinity routing failed — falling through to staging", {
        signalReportId: input.signalReportId,
        error,
      });
      return null;
    }
  }

  private buildNestText(nest: Nest): string {
    return [nest.name, nest.goalPrompt, nest.definitionOfDone]
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .join("\n\n");
  }

  private async resolveTeamId(apiHost: string): Promise<number | null> {
    if (this.cachedTeamContext?.apiHost === apiHost) {
      return this.cachedTeamContext.teamId;
    }
    const response = await this.auth.authenticatedFetch(
      fetch,
      `${apiHost}/api/users/@me/`,
    );
    if (!response.ok) return null;
    const data = (await response.json().catch(() => ({}))) as {
      team?: { id?: unknown } | null;
    };
    const id = data.team?.id;
    if (typeof id !== "number") return null;
    this.cachedTeamContext = { apiHost, teamId: id };
    return id;
  }

  private async queryBestMatch(input: {
    apiHost: string;
    teamId: number;
    signalReportId: string;
    candidates: Array<{ id: string; text: string }>;
  }): Promise<{ nestId: string; distance: number } | null> {
    // Build UNION ALL of per-nest distance computations against the latest
    // embedding row for this signal report. Each branch is parameter-bound
    // (HogQL `{name}` placeholders), so operator-owned nest text doesn't
    // need escaping. The repeated signal-embedding subquery is fine in v1 —
    // ClickHouse's optimiser handles it cheaply, and N is bounded by the
    // active-nest cap.
    const values: Record<string, unknown> = {
      signal_id: input.signalReportId,
    };
    const branches = input.candidates
      .map((nest, i) => {
        const idKey = `nest_id_${i}`;
        const goalKey = `goal_${i}`;
        values[idKey] = nest.id;
        values[goalKey] = nest.text;
        return `SELECT {${idKey}} AS nest_id, cosineDistance(embedText({${goalKey}}), s.embedding) AS distance FROM (SELECT embedding FROM document_embeddings WHERE document_id = {signal_id} AND document_type = 'signal_report' ORDER BY timestamp DESC LIMIT 1) s`;
      })
      .join(" UNION ALL ");

    const sql = `SELECT nest_id, distance FROM (${branches}) ORDER BY distance ASC LIMIT 1`;

    const url = `${input.apiHost}/api/projects/${input.teamId}/query/`;
    const response = await this.auth.authenticatedFetch(fetch, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: { kind: "HogQLQuery", query: sql, values },
      }),
    });
    if (!response.ok) {
      log.warn("Affinity HogQL query non-OK", { status: response.status });
      return null;
    }

    const data = (await response.json().catch(() => ({}))) as {
      results?: unknown;
      error?: string | null;
    };
    if (data.error) {
      log.warn("Affinity HogQL query returned error", { error: data.error });
      return null;
    }
    if (!Array.isArray(data.results) || data.results.length === 0) {
      return null;
    }
    const row = data.results[0];
    if (!Array.isArray(row) || row.length < 2) return null;
    const nestId = typeof row[0] === "string" ? row[0] : null;
    const distance = typeof row[1] === "number" ? row[1] : null;
    if (nestId === null || distance === null) return null;
    return { nestId, distance };
  }
}
