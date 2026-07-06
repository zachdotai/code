import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import type { RootLogger, ScopedLogger } from "@posthog/di/logger";
import { describe, expect, it } from "vitest";
import { EntityRegistry } from "../local-store/entityRegistry";
import { ApplyPipeline } from "../local-store/sync/applyPipeline";
import {
  INBOX_REPORTS_COLLECTION,
  InboxReportsDeltaSource,
  inboxReportsEntity,
} from "./inboxSync";

const noopScoped: ScopedLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
const fakeLogger: RootLogger = { ...noopScoped, scope: () => noopScoped };

function makeClient(
  pipeline: { results: unknown[]; count: number },
  dismissed: { results: unknown[]; count: number },
) {
  const calls: Array<Record<string, unknown> | undefined> = [];
  const client = {
    getSignalReports: async (params?: { status?: string }) => {
      calls.push(params);
      return params?.status?.includes("suppressed") ? dismissed : pipeline;
    },
  } as unknown as PostHogAPIClient;
  return { client, calls };
}

describe("InboxReportsDeltaSource", () => {
  it("skips without a client", async () => {
    const source = new InboxReportsDeltaSource({ getClient: () => null });
    expect(await source.pull()).toBeNull();
  });

  it("pulls pipeline and dismissed windows with status-scoped sweeps", async () => {
    const { client } = makeClient(
      { results: [{ id: "r1", status: "ready" }], count: 1 },
      { results: [{ id: "r2", status: "suppressed" }], count: 1 },
    );
    const source = new InboxReportsDeltaSource({ getClient: () => client });

    const windows = await source.pull();
    expect(windows?.map((w) => w.key)).toEqual(["pipeline", "dismissed"]);

    const pipelineSweep = windows?.[0]?.sweep;
    expect(pipelineSweep?.complete).toBe(true);
    expect(pipelineSweep?.matches({ id: "x", status: "ready" } as never)).toBe(
      true,
    );
    expect(
      pipelineSweep?.matches({ id: "x", status: "suppressed" } as never),
    ).toBe(false);

    const dismissedSweep = windows?.[1]?.sweep;
    expect(
      dismissedSweep?.matches({ id: "x", status: "resolved" } as never),
    ).toBe(true);
    expect(dismissedSweep?.matches({ id: "x", status: "ready" } as never)).toBe(
      false,
    );
  });

  it("marks a window incomplete when the page did not cover the full set", async () => {
    const { client } = makeClient(
      { results: [{ id: "r1", status: "ready" }], count: 250 },
      { results: [], count: 0 },
    );
    const source = new InboxReportsDeltaSource({ getClient: () => client });
    const windows = await source.pull();
    expect(windows?.[0]?.sweep?.complete).toBe(false);
    expect(windows?.[1]?.sweep?.complete).toBe(true);
  });

  it("dismissing a report elsewhere moves it between windows without ghosts", async () => {
    const registry = new EntityRegistry();
    const pool = registry.register(inboxReportsEntity);
    const pipeline = new ApplyPipeline(registry, fakeLogger);

    // First pull: report active.
    const first = new InboxReportsDeltaSource({
      getClient: () =>
        makeClient(
          {
            results: [{ id: "r1", status: "ready", updated_at: "1" }],
            count: 1,
          },
          { results: [], count: 0 },
        ).client,
    });
    pipeline.applyWindows(INBOX_REPORTS_COLLECTION, (await first.pull()) ?? []);
    expect((pool.get("r1") as { status?: string }).status).toBe("ready");

    // Second pull: report was archived on another device.
    const second = new InboxReportsDeltaSource({
      getClient: () =>
        makeClient(
          { results: [], count: 0 },
          {
            results: [{ id: "r1", status: "suppressed", updated_at: "2" }],
            count: 1,
          },
        ).client,
    });
    pipeline.applyWindows(
      INBOX_REPORTS_COLLECTION,
      (await second.pull()) ?? [],
    );

    expect((pool.get("r1") as { status?: string }).status).toBe("suppressed");
    expect(pool.getAll()).toHaveLength(1);
  });
});
