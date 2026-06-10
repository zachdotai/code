import type { AuthService } from "@posthog/core/auth/auth";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type {
  DashboardQuery,
  DashboardQueryResult,
  DashboardQueryRunInput,
} from "./schemas";

const log = logger.scope("dashboard-query");

// Run at most this many HogQL queries at once so a wide dashboard doesn't
// hammer the query endpoint.
const CONCURRENCY = 5;

interface HogQLResponse {
  results?: unknown[];
  columns?: string[];
  error?: string | null;
}

// Executes the HogQL queries stored on a dashboard's data points and returns a
// single scalar value per point. Used by the dashboard refresh flow.
@injectable()
export class DashboardQueryService {
  constructor(
    @inject(MAIN_TOKENS.AuthService)
    private readonly authService: AuthService,
  ) {}

  async run(input: DashboardQueryRunInput): Promise<DashboardQueryResult[]> {
    const { queries } = input;
    if (queries.length === 0) return [];

    const { apiHost } = await this.authService.getValidAccessToken();
    const projectId = this.authService.getState().currentProjectId;
    if (projectId == null) {
      return queries.map((q) => fail(q, "No PostHog project selected"));
    }

    const url = `${apiHost}/api/projects/${projectId}/query/`;
    const results: DashboardQueryResult[] = [];

    // Simple capped batches; preserves input order in the output.
    for (let i = 0; i < queries.length; i += CONCURRENCY) {
      const batch = queries.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((q) => this.runOne(url, q)),
      );
      settled.forEach((s, j) => {
        results.push(
          s.status === "fulfilled"
            ? s.value
            : fail(batch[j], errorMessage(s.reason)),
        );
      });
    }

    return results;
  }

  private async runOne(
    url: string,
    q: DashboardQuery,
  ): Promise<DashboardQueryResult> {
    const response = await this.authService.authenticatedFetch(fetch, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: q.query } }),
    });

    if (!response.ok) {
      return fail(q, `Query failed (${response.status})`);
    }

    const body = (await response.json()) as HogQLResponse;
    if (body.error) return fail(q, body.error);

    const rows = body.results;
    if (!Array.isArray(rows) || rows.length === 0) {
      return fail(q, "Query returned no rows");
    }

    const firstRow = rows[0];
    if (!Array.isArray(firstRow)) {
      return fail(q, "Unexpected result shape");
    }

    // Read the named column if given, else the first cell of the first row.
    const colIndex =
      q.column && body.columns ? body.columns.indexOf(q.column) : 0;
    const cell = firstRow[colIndex >= 0 ? colIndex : 0];

    if (typeof cell === "number" || typeof cell === "string") {
      return {
        ok: true,
        elementKey: q.elementKey,
        propPath: q.propPath,
        value: cell,
      };
    }
    return fail(q, "Unsupported value type");
  }
}

function fail(q: DashboardQuery, error: string): DashboardQueryResult {
  log.warn("Dashboard query failed", {
    elementKey: q.elementKey,
    propPath: q.propPath,
    error,
  });
  return { ok: false, elementKey: q.elementKey, propPath: q.propPath, error };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
