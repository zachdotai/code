import type { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import {
  defineEntity,
  type SyncedEntity,
} from "@posthog/core/local-store/schemas";
import type {
  DeltaSource,
  PulledWindow,
} from "@posthog/core/local-store/sync/deltaSource";
import type { CloudClientProvider } from "@posthog/core/local-store/sync/identifiers";
import type { SyncEngine } from "@posthog/core/local-store/sync/syncEngine";
import { z } from "zod";
import {
  INBOX_DISMISSED_STATUS_FILTER,
  INBOX_PIPELINE_STATUS_FILTER,
} from "./reportFiltering";

export const INBOX_REPORTS_COLLECTION = "inbox_reports";

/** Replaces the 3-second per-hook polling as the inbox's freshness source. */
const INBOX_PULL_INTERVAL_MS = 15_000;
const INBOX_PAGE_LIMIT = 100;

export const inboxReportEntitySchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  updated_at: z.string().nullish(),
});

export const inboxReportsEntity = defineEntity<SyncedEntity>({
  name: INBOX_REPORTS_COLLECTION,
  version: 1,
  schema: inboxReportEntitySchema as unknown as z.ZodType<SyncedEntity>,
  hydration: "eager",
});

const PIPELINE_STATUSES = new Set(INBOX_PIPELINE_STATUS_FILTER.split(","));
const DISMISSED_STATUSES = new Set(INBOX_DISMISSED_STATUS_FILTER.split(","));

function reportStatus(row: SyncedEntity): string {
  return (row as { status?: string }).status ?? "";
}

/**
 * Project-wide signal-report windows: the active pipeline plus the newest
 * archived page. Each window sweeps only rows whose status belongs to its
 * scope, and only when the page actually covered the whole matching set
 * (`results.length === count`) — reviewer/priority/source filtering stays a
 * local/selector concern over these superset rows.
 */
export class InboxReportsDeltaSource implements DeltaSource<SyncedEntity> {
  readonly collection = INBOX_REPORTS_COLLECTION;
  readonly intervalMs = INBOX_PULL_INTERVAL_MS;

  constructor(private readonly provider: CloudClientProvider) {}

  async pull(): Promise<PulledWindow<SyncedEntity>[] | null> {
    const client = this.provider.getClient();
    if (!client) return null;

    const [pipeline, dismissed] = await Promise.all([
      client.getSignalReports({
        status: INBOX_PIPELINE_STATUS_FILTER,
        ordering: "-updated_at",
        limit: INBOX_PAGE_LIMIT,
      }),
      client.getSignalReports({
        status: INBOX_DISMISSED_STATUS_FILTER,
        ordering: "-updated_at",
        limit: INBOX_PAGE_LIMIT,
      }),
    ]);

    return [
      {
        key: "pipeline",
        rows: pipeline.results as unknown as SyncedEntity[],
        sweep: {
          complete: pipeline.results.length >= pipeline.count,
          matches: (row) => PIPELINE_STATUSES.has(reportStatus(row)),
        },
      },
      {
        key: "dismissed",
        rows: dismissed.results as unknown as SyncedEntity[],
        sweep: {
          complete: dismissed.results.length >= dismissed.count,
          matches: (row) => DISMISSED_STATUSES.has(reportStatus(row)),
        },
      },
    ];
  }
}

export function registerInboxSync(
  registry: EntityRegistry,
  engine: SyncEngine,
  provider: CloudClientProvider,
): void {
  registry.register(inboxReportsEntity);
  engine.registerSource(new InboxReportsDeltaSource(provider));
}
