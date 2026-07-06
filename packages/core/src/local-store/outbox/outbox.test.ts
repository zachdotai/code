import type { RootLogger, ScopedLogger } from "@posthog/di/logger";
import type { OutboxEntry } from "@posthog/platform/local-persistence";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EntityRegistry } from "../entityRegistry";
import { FakeLocalPersistence } from "../fakeLocalPersistence";
import { LocalStoreService } from "../localStoreService";
import { Persister } from "../persister";
import { defineEntity, type SyncedEntity } from "../schemas";
import { ApplyPipeline } from "../sync/applyPipeline";
import { Outbox } from "./outbox";
import { type MutationExecutor, OutboxFlusher } from "./outboxFlusher";

const noopScoped: ScopedLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
const fakeLogger: RootLogger = { ...noopScoped, scope: () => noopScoped };

const rowSchema = z.looseObject({
  id: z.string(),
  updated_at: z.string().nullish(),
}) as unknown as z.ZodType<SyncedEntity>;

const NS = { userId: "US", projectId: 1 };

async function makeRig(persistence = new FakeLocalPersistence()) {
  const registry = new EntityRegistry();
  const pool = registry.register(
    defineEntity({
      name: "rows",
      version: 1,
      schema: rowSchema,
      hydration: "eager",
    }),
  );
  const persister = new Persister(registry, fakeLogger, 1);
  const store = new LocalStoreService(
    persistence,
    registry,
    persister,
    fakeLogger,
  );
  const outbox = new Outbox(store, registry, fakeLogger);
  const pipeline = new ApplyPipeline(registry, fakeLogger);
  pipeline.setPendingOverlayProvider((c, id) => outbox.pendingOverlay(c, id));
  const flusher = new OutboxFlusher(outbox, pipeline, fakeLogger);
  await store.open(NS);
  await outbox.replayOntoPools();
  return {
    persistence,
    registry,
    pool,
    persister,
    store,
    outbox,
    pipeline,
    flusher,
  };
}

function executor(
  impl: (entry: OutboxEntry) => Promise<SyncedEntity | null | "skip">,
): MutationExecutor {
  return { collection: "rows", op: "update", execute: impl };
}

describe("Outbox", () => {
  it("enqueue persists the entry and exposes the pending overlay", async () => {
    const { outbox } = await makeRig();
    await outbox.enqueue({
      collection: "rows",
      recordId: "r1",
      op: "update",
      payload: { name: "optimistic" },
      oldValues: { name: "old" },
    });

    expect(outbox.pendingOverlay("rows", "r1")).toEqual({ name: "optimistic" });
    expect(outbox.queuedCount()).toBe(1);
  });

  it("survives restart: entries reload and re-overlay onto pools", async () => {
    const persistence = new FakeLocalPersistence();
    const first = await makeRig(persistence);
    first.pool.applyUpserts([{ id: "r1", name: "server" } as SyncedEntity]);
    await first.persister.flush();
    await first.outbox.enqueue({
      collection: "rows",
      recordId: "r1",
      op: "update",
      payload: { name: "pending-edit" },
      oldValues: { name: "server" },
    });
    await first.store.close();

    const second = await makeRig(persistence);
    const row = second.pool.get("r1") as { name?: string } | undefined;
    expect(row?.name).toBe("pending-edit");
    expect(second.outbox.queuedCount()).toBe(1);
  });

  it("pulls rebase over pending edits instead of reverting them", async () => {
    const { pool, outbox, pipeline } = await makeRig();
    pool.applyUpserts([{ id: "r1", name: "server-v1" } as SyncedEntity]);
    await outbox.enqueue({
      collection: "rows",
      recordId: "r1",
      op: "update",
      payload: { name: "local-edit" },
      oldValues: { name: "server-v1" },
    });

    pipeline.applyWindows("rows", [
      {
        key: "w",
        rows: [{ id: "r1", name: "server-v2", extra: 1 } as SyncedEntity],
        sweep: null,
      },
    ]);

    const row = pool.get("r1") as { name?: string; extra?: number };
    expect(row.name).toBe("local-edit"); // pending field wins in the pool
    expect(row.extra).toBe(1); // other fields still update
  });
});

describe("OutboxFlusher", () => {
  it("flushes queued entries and applies the acknowledged row", async () => {
    const { pool, outbox, flusher } = await makeRig();
    pool.applyUpserts([{ id: "r1", name: "old" } as SyncedEntity]);
    await outbox.enqueue({
      collection: "rows",
      recordId: "r1",
      op: "update",
      payload: { name: "new" },
      oldValues: { name: "old" },
    });

    flusher.registerExecutor(
      executor(async (entry) => ({
        id: entry.recordId,
        name: "new",
        updated_at: "2026-07-05",
      })),
    );
    flusher.start();
    await flusher.pump();
    flusher.stop();

    expect(outbox.list()).toHaveLength(0);
    expect((pool.get("r1") as { name?: string }).name).toBe("new");
  });

  it("skip (no client) leaves the entry queued without burning attempts", async () => {
    const { outbox, flusher } = await makeRig();
    await outbox.enqueue({
      collection: "rows",
      recordId: "r1",
      op: "update",
      payload: {},
      oldValues: {},
    });
    flusher.registerExecutor(executor(async () => "skip"));
    flusher.start();
    await flusher.pump();
    flusher.stop();

    const entry = outbox.list()[0];
    expect(entry?.state).toBe("queued");
    expect(entry?.attempts).toBe(0);
  });

  it("parks after max attempts, rolls back, and emits a parked event", async () => {
    const { pool, outbox, flusher } = await makeRig();
    pool.applyUpserts([{ id: "r1", name: "optimistic" } as SyncedEntity]);
    await outbox.enqueue({
      collection: "rows",
      recordId: "r1",
      op: "update",
      payload: { name: "optimistic" },
      oldValues: { name: "original" },
    });

    const parked = vi.fn();
    outbox.events.on("parked", parked);
    flusher.registerExecutor(
      executor(async () => {
        throw new Error("400 bad request");
      }),
    );
    flusher.start();
    await flusher.pump(); // attempt 1 → retry backoff
    await flusher.pump(); // attempt 2 → retry backoff
    await flusher.pump(); // attempt 3 → parked
    flusher.stop();

    expect(parked).toHaveBeenCalledTimes(1);
    expect(outbox.list()[0]?.state).toBe("parked");
    expect((pool.get("r1") as { name?: string }).name).toBe("original");
  });

  it("a parked entry blocks later entries for the same record only", async () => {
    const { outbox } = await makeRig();
    await outbox.enqueue({
      collection: "rows",
      recordId: "blocked",
      op: "update",
      payload: {},
      oldValues: {},
    });
    await outbox.enqueue({
      collection: "rows",
      recordId: "blocked",
      op: "update",
      payload: {},
      oldValues: {},
    });
    await outbox.enqueue({
      collection: "rows",
      recordId: "free",
      op: "update",
      payload: {},
      oldValues: {},
    });

    const [first] = outbox.list();
    if (!first) throw new Error("missing entry");
    await outbox.park(first, "boom");

    const next = outbox.nextQueued();
    expect(next?.recordId).toBe("free");
  });
});
