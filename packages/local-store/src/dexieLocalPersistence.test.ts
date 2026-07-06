import "fake-indexeddb/auto";
import type { NewOutboxEntry } from "@posthog/platform/local-persistence";
import { beforeEach, describe, expect, it } from "vitest";
import { DexieLocalPersistence } from "./dexieLocalPersistence";

let counter = 0;
function uniqueNamespace(): string {
  counter += 1;
  return `user-1:project-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

function outboxEntry(overrides: Partial<NewOutboxEntry> = {}): NewOutboxEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 10)}`,
    collection: "tasks",
    recordId: "task-1",
    op: "update",
    payload: { name: "renamed" },
    oldValues: { name: "old" },
    state: "queued",
    attempts: 0,
    enqueuedAt: "2026-07-05T00:00:00.000Z",
    leaseUntil: null,
    lastError: null,
    ...overrides,
  };
}

describe("DexieLocalPersistence", () => {
  let persistence: DexieLocalPersistence;

  beforeEach(() => {
    persistence = new DexieLocalPersistence();
  });

  it("round-trips records per collection", async () => {
    const handle = await persistence.open(uniqueNamespace());
    await handle.bulkPut([
      {
        collection: "tasks",
        id: "a",
        updatedAt: "2026-01-01",
        data: { id: "a", name: "A" },
      },
      {
        collection: "tasks",
        id: "b",
        updatedAt: null,
        data: { id: "b", name: "B" },
      },
      {
        collection: "reports",
        id: "a",
        updatedAt: null,
        data: { id: "a", kind: "report" },
      },
    ]);

    const tasks = await handle.getAll("tasks");
    expect(tasks.map((r) => r.id).sort()).toEqual(["a", "b"]);

    const reports = await handle.getAll("reports");
    expect(reports).toHaveLength(1);
    expect(reports[0]?.data).toEqual({ id: "a", kind: "report" });

    const some = await handle.getMany("tasks", ["a", "missing"]);
    expect(some).toHaveLength(1);
    expect(some[0]?.data).toEqual({ id: "a", name: "A" });
  });

  it("upserts on repeated bulkPut of the same key", async () => {
    const handle = await persistence.open(uniqueNamespace());
    await handle.bulkPut([
      { collection: "tasks", id: "a", updatedAt: null, data: { v: 1 } },
    ]);
    await handle.bulkPut([
      { collection: "tasks", id: "a", updatedAt: "2026-01-02", data: { v: 2 } },
    ]);

    const rows = await handle.getAll("tasks");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toEqual({ v: 2 });
    expect(rows[0]?.updatedAt).toBe("2026-01-02");
  });

  it("bulkDelete removes only the given ids in the given collection", async () => {
    const handle = await persistence.open(uniqueNamespace());
    await handle.bulkPut([
      { collection: "tasks", id: "a", updatedAt: null, data: {} },
      { collection: "tasks", id: "b", updatedAt: null, data: {} },
      { collection: "reports", id: "a", updatedAt: null, data: {} },
    ]);

    await handle.bulkDelete("tasks", ["a"]);

    expect((await handle.getAll("tasks")).map((r) => r.id)).toEqual(["b"]);
    expect(await handle.getAll("reports")).toHaveLength(1);
  });

  it("clearRecords drops all model rows but preserves meta and outbox", async () => {
    const handle = await persistence.open(uniqueNamespace());
    await handle.bulkPut([
      { collection: "tasks", id: "a", updatedAt: null, data: {} },
    ]);
    await handle.setMeta("schemaHash", "abc");
    await handle.outboxAdd(outboxEntry());

    await handle.clearRecords();

    expect(await handle.getAll("tasks")).toHaveLength(0);
    expect(await handle.getMeta("schemaHash")).toBe("abc");
    expect(await handle.outboxList()).toHaveLength(1);
  });

  it("meta is a string KV with delete", async () => {
    const handle = await persistence.open(uniqueNamespace());
    expect(await handle.getMeta("cursor:tasks")).toBeNull();

    await handle.setMeta("cursor:tasks", "2026-07-01T00:00:00Z");
    expect(await handle.getMeta("cursor:tasks")).toBe("2026-07-01T00:00:00Z");

    await handle.setMeta("cursor:tasks", "2026-07-02T00:00:00Z");
    expect(await handle.getMeta("cursor:tasks")).toBe("2026-07-02T00:00:00Z");

    await handle.deleteMeta("cursor:tasks");
    expect(await handle.getMeta("cursor:tasks")).toBeNull();
  });

  it("outbox assigns monotonic seq, lists in order, updates and deletes by id", async () => {
    const handle = await persistence.open(uniqueNamespace());
    const first = await handle.outboxAdd(outboxEntry({ id: "one" }));
    const second = await handle.outboxAdd(outboxEntry({ id: "two" }));
    expect(second.seq).toBeGreaterThan(first.seq);

    await handle.outboxUpdate("one", {
      state: "executing",
      attempts: 1,
      leaseUntil: "2026-07-05T00:01:00.000Z",
    });

    const listed = await handle.outboxList();
    expect(listed.map((e) => e.id)).toEqual(["one", "two"]);
    expect(listed[0]?.state).toBe("executing");
    expect(listed[0]?.attempts).toBe(1);
    expect(listed[0]?.leaseUntil).toBe("2026-07-05T00:01:00.000Z");

    await handle.outboxDelete("one");
    expect((await handle.outboxList()).map((e) => e.id)).toEqual(["two"]);
  });

  it("namespaces are isolated and deletable", async () => {
    const nsA = uniqueNamespace();
    const nsB = uniqueNamespace();
    const a = await persistence.open(nsA);
    const b = await persistence.open(nsB);

    await a.bulkPut([
      { collection: "tasks", id: "a", updatedAt: null, data: {} },
    ]);
    expect(await b.getAll("tasks")).toHaveLength(0);

    await a.close();
    await persistence.deleteNamespace(nsA);

    const reopened = await persistence.open(nsA);
    expect(await reopened.getAll("tasks")).toHaveLength(0);
  });
});
