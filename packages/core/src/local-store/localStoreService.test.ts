import type { RootLogger, ScopedLogger } from "@posthog/di/logger";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EntityRegistry } from "./entityRegistry";
import { FakeLocalPersistence } from "./fakeLocalPersistence";
import { LocalStoreService } from "./localStoreService";
import { Persister } from "./persister";
import { computeSchemaHash, defineEntity } from "./schemas";

const noopScoped: ScopedLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
const fakeLogger: RootLogger = {
  ...noopScoped,
  scope: () => noopScoped,
};

const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  updated_at: z.string().nullish(),
});
type FakeTask = z.infer<typeof taskSchema>;

const transcriptSchema = z.object({
  id: z.string(),
  body: z.string(),
});

function makeRig(persistence = new FakeLocalPersistence()) {
  const registry = new EntityRegistry();
  const taskPool = registry.register(
    defineEntity<FakeTask>({
      name: "tasks",
      version: 1,
      schema: taskSchema,
      hydration: "eager",
    }),
  );
  const transcriptPool = registry.register(
    defineEntity({
      name: "transcripts",
      version: 1,
      schema: transcriptSchema,
      hydration: "lazy",
    }),
  );
  const persister = new Persister(registry, fakeLogger, 1);
  const service = new LocalStoreService(
    persistence,
    registry,
    persister,
    fakeLogger,
  );
  return {
    persistence,
    registry,
    taskPool,
    transcriptPool,
    persister,
    service,
  };
}

const NS = { userId: "1", projectId: 2 };

describe("LocalStoreService", () => {
  it("first open requires bootstrap and stamps the schema hash", async () => {
    const { service } = makeRig();
    const result = await service.open(NS);
    expect(result.bootstrapRequired).toBe(true);
    expect(result.namespace).toBe("u1:p2");

    const handle = service.getHandle();
    expect(await handle?.getMeta("schemaHash")).toBeTruthy();
  });

  it("persists pool writes and hydrates them back on reopen", async () => {
    const persistence = new FakeLocalPersistence();
    const first = makeRig(persistence);
    await first.service.open(NS);

    first.taskPool.applyUpserts([
      { id: "t1", name: "Make it fast", updated_at: "2026-07-01" },
    ]);
    await first.persister.flush();
    await first.service.close();

    // Fresh rig = app restart (new pools, same persisted data).
    const second = makeRig(persistence);
    const result = await second.service.open(NS);

    expect(result.bootstrapRequired).toBe(false);
    expect(second.taskPool.store.getState().hydrated).toBe(true);
    expect(second.taskPool.get("t1")?.name).toBe("Make it fast");
  });

  it("does not persist changes flagged persist:false", async () => {
    const { service, taskPool, persister } = makeRig();
    await service.open(NS);

    taskPool.applyUpserts([{ id: "follower", name: "Broadcast apply" }], {
      persist: false,
    });
    await persister.flush();

    const handle = service.getHandle();
    expect(await handle?.getAll("tasks")).toHaveLength(0);
  });

  it("schema hash mismatch nukes records but preserves the outbox", async () => {
    const persistence = new FakeLocalPersistence();
    const first = makeRig(persistence);
    await first.service.open(NS);
    first.taskPool.applyUpserts([{ id: "t1", name: "Old shape" }]);
    await first.persister.flush();
    await first.service.getHandle()?.outboxAdd({
      id: "pending-1",
      collection: "tasks",
      recordId: "t1",
      op: "update",
      payload: { name: "New" },
      oldValues: { name: "Old shape" },
      state: "queued",
      attempts: 0,
      enqueuedAt: "2026-07-05T00:00:00.000Z",
      leaseUntil: null,
      lastError: null,
    });
    await first.service.close();

    // Same persistence, but the tasks entity shape bumped to version 2.
    const registry = new EntityRegistry();
    const taskPool = registry.register(
      defineEntity<FakeTask>({
        name: "tasks",
        version: 2,
        schema: taskSchema,
        hydration: "eager",
      }),
    );
    const persister = new Persister(registry, fakeLogger, 1);
    const service = new LocalStoreService(
      persistence,
      registry,
      persister,
      fakeLogger,
    );

    const result = await service.open(NS);

    expect(result.bootstrapRequired).toBe(true);
    expect(taskPool.getAll()).toHaveLength(0);
    expect(await service.getHandle()?.outboxList()).toHaveLength(1);
  });

  it("hydrates lazy collections only on demand", async () => {
    const persistence = new FakeLocalPersistence();
    const first = makeRig(persistence);
    await first.service.open(NS);
    first.transcriptPool.applyUpserts([{ id: "tr1", body: "hello" }]);
    await first.persister.flush();
    await first.service.close();

    const second = makeRig(persistence);
    await second.service.open(NS);

    expect(second.transcriptPool.store.getState().hydrated).toBe(false);
    expect(second.transcriptPool.getAll()).toHaveLength(0);

    await second.service.hydrateCollection("transcripts");

    expect(second.transcriptPool.store.getState().hydrated).toBe(true);
    expect(second.transcriptPool.get("tr1")?.body).toBe("hello");
  });

  it("drops persisted rows that fail schema validation on hydration", async () => {
    const persistence = new FakeLocalPersistence();
    const first = makeRig(persistence);
    await first.service.open(NS);
    const handle = first.service.getHandle();
    await handle?.bulkPut([
      {
        collection: "tasks",
        id: "ok",
        updatedAt: null,
        data: { id: "ok", name: "Valid" },
      },
      { collection: "tasks", id: "bad", updatedAt: null, data: { id: "bad" } },
    ]);
    await first.service.close();

    const second = makeRig(persistence);
    await second.service.open(NS);

    expect(second.taskPool.getAll().map((t) => t.id)).toEqual(["ok"]);
  });

  it("wipeNamespace deletes the database and clears pools", async () => {
    const persistence = new FakeLocalPersistence();
    const rig = makeRig(persistence);
    await rig.service.open(NS);
    rig.taskPool.applyUpserts([{ id: "t1", name: "Sensitive" }]);
    await rig.persister.flush();

    await rig.service.wipeNamespace(NS);

    expect(rig.taskPool.getAll()).toHaveLength(0);
    expect(persistence.namespaces.has("u1:p2")).toBe(false);

    const reopened = await rig.service.open(NS);
    expect(reopened.bootstrapRequired).toBe(true);
    expect(rig.taskPool.getAll()).toHaveLength(0);
  });

  it("switching namespaces clears pools before hydrating the new scope", async () => {
    const persistence = new FakeLocalPersistence();
    const rig = makeRig(persistence);
    await rig.service.open(NS);
    rig.taskPool.applyUpserts([{ id: "t1", name: "Project 2 task" }]);
    await rig.persister.flush();

    await rig.service.open({ userId: "1", projectId: 3 });

    expect(rig.service.namespace).toBe("u1:p3");
    expect(rig.taskPool.getAll()).toHaveLength(0);
  });

  it("schema hash is stable across registration order and sensitive to versions", () => {
    const a = computeSchemaHash([
      { name: "tasks", version: 1 },
      { name: "reports", version: 3 },
    ]);
    const b = computeSchemaHash([
      { name: "reports", version: 3 },
      { name: "tasks", version: 1 },
    ]);
    const c = computeSchemaHash([
      { name: "reports", version: 4 },
      { name: "tasks", version: 1 },
    ]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
