import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import type { RootLogger, ScopedLogger } from "@posthog/di/logger";
import { describe, expect, it } from "vitest";
import { EntityRegistry } from "../local-store/entityRegistry";
import { FakeLocalPersistence } from "../local-store/fakeLocalPersistence";
import { LocalStoreService } from "../local-store/localStoreService";
import { Outbox } from "../local-store/outbox/outbox";
import { Persister } from "../local-store/persister";
import type { SyncedEntity } from "../local-store/schemas";
import { ApplyPipeline } from "../local-store/sync/applyPipeline";
import { TaskMutationService } from "./taskMutations";
import { taskSummariesEntity, tasksEntity } from "./taskSync";

const noopScoped: ScopedLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
const fakeLogger: RootLogger = { ...noopScoped, scope: () => noopScoped };

async function makeRig(client: Partial<PostHogAPIClient> | null = null) {
  const registry = new EntityRegistry();
  const tasksPool = registry.register(tasksEntity);
  const summariesPool = registry.register(taskSummariesEntity);
  const persister = new Persister(registry, fakeLogger, 1);
  const store = new LocalStoreService(
    new FakeLocalPersistence(),
    registry,
    persister,
    fakeLogger,
  );
  const outbox = new Outbox(store, registry, fakeLogger);
  const pipeline = new ApplyPipeline(registry, fakeLogger);
  pipeline.setPendingOverlayProvider((c, id) => outbox.pendingOverlay(c, id));
  const service = new TaskMutationService(registry, outbox, pipeline, {
    getClient: () => (client as PostHogAPIClient) ?? null,
  });
  await store.open({ userId: "US", projectId: 1 });
  return { registry, tasksPool, summariesPool, outbox, service };
}

describe("TaskMutationService", () => {
  it("updateTask applies optimistically, records oldValues, and syncs summary titles", async () => {
    const { tasksPool, summariesPool, outbox, service } = await makeRig();
    tasksPool.applyUpserts([
      {
        id: "t1",
        title: "Old title",
        updated_at: "2026-01-01",
      } as SyncedEntity,
    ]);
    summariesPool.applyUpserts([
      { id: "t1", title: "Old title" } as SyncedEntity,
    ]);

    await service.updateTask("t1", { title: "New title" });

    expect((tasksPool.get("t1") as { title?: string }).title).toBe("New title");
    expect((summariesPool.get("t1") as { title?: string }).title).toBe(
      "New title",
    );
    const entry = outbox.list()[0];
    expect(entry?.op).toBe("update");
    expect(entry?.payload).toEqual({ title: "New title" });
    expect(entry?.oldValues).toEqual({ title: "Old title" });
  });

  it("createTask shows a placeholder immediately and swaps in the server row", async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    const created = new Promise((resolve) => {
      resolveCreate = resolve;
    });
    const { tasksPool, service } = await makeRig({
      createTask: () => created,
    } as unknown as Partial<PostHogAPIClient>);

    const pending = service.createTask({ description: "Ship it" });
    expect(tasksPool.getAll().some((t) => t.id.startsWith("pending-"))).toBe(
      true,
    );

    resolveCreate({
      id: "server-1",
      title: "Ship it",
      description: "Ship it",
      repository: "org/repo",
      origin_product: "user_created",
      created_at: "2026-07-05",
      updated_at: "2026-07-05",
    });
    const task = await pending;

    expect(task.id).toBe("server-1");
    expect(tasksPool.get("server-1")).toBeDefined();
    expect(tasksPool.getAll().some((t) => t.id.startsWith("pending-"))).toBe(
      false,
    );
  });

  it("createTask removes the placeholder when the server rejects", async () => {
    const { tasksPool, service } = await makeRig({
      createTask: () => Promise.reject(new Error("400")),
    } as unknown as Partial<PostHogAPIClient>);

    await expect(service.createTask({ description: "Nope" })).rejects.toThrow(
      "400",
    );
    expect(tasksPool.getAll()).toHaveLength(0);
  });

  it("removeTaskLocally hides instantly and supports rollback and confirm", async () => {
    const { tasksPool, summariesPool, service } = await makeRig();
    tasksPool.applyUpserts([{ id: "t1", title: "Task" } as SyncedEntity]);
    summariesPool.applyUpserts([{ id: "t1" } as SyncedEntity]);

    const removal = service.removeTaskLocally("t1");
    expect(tasksPool.get("t1")).toBeUndefined();
    expect(summariesPool.get("t1")).toBeUndefined();

    removal.rollback();
    expect(tasksPool.get("t1")).toBeDefined();
    expect(summariesPool.get("t1")).toBeDefined();

    const removal2 = service.removeTaskLocally("t1");
    removal2.confirm();
    expect(tasksPool.get("t1")).toBeUndefined();
  });
});
