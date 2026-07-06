import type { RootLogger, ScopedLogger } from "@posthog/di/logger";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EntityRegistry } from "../entityRegistry";
import { defineEntity, type SyncedEntity } from "../schemas";
import { ApplyPipeline } from "./applyPipeline";
import type { PulledWindow } from "./deltaSource";

const noopScoped: ScopedLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
const fakeLogger: RootLogger = { ...noopScoped, scope: () => noopScoped };

interface Row extends SyncedEntity {
  id: string;
  name?: string;
  internal?: boolean;
  updated_at?: string | null;
}

const rowSchema = z.looseObject({
  id: z.string(),
  updated_at: z.string().nullish(),
}) as unknown as z.ZodType<SyncedEntity>;

function makeRig() {
  const registry = new EntityRegistry();
  const pool = registry.register(
    defineEntity({
      name: "rows",
      version: 1,
      schema: rowSchema,
      hydration: "eager",
    }),
  );
  const pipeline = new ApplyPipeline(registry, fakeLogger);
  return { registry, pool, pipeline };
}

function window_(
  rows: Row[],
  sweep: PulledWindow<SyncedEntity>["sweep"] = {
    complete: true,
    matches: () => true,
  },
  key = "w",
): PulledWindow<SyncedEntity> {
  return { key, rows, sweep };
}

describe("ApplyPipeline", () => {
  it("applies new rows and marks the pool hydrated", () => {
    const { pool, pipeline } = makeRig();
    const delta = pipeline.applyWindows("rows", [
      window_([{ id: "a", updated_at: "2026-01-01" }]),
    ]);

    expect(delta.upserts.map((r) => r.id)).toEqual(["a"]);
    expect(pool.get("a")).toBeDefined();
    expect(pool.store.getState().hydrated).toBe(true);
  });

  it("last-write-wins: keeps newer local rows, applies newer remote rows", () => {
    const { pool, pipeline } = makeRig();
    pool.applyUpserts([
      { id: "newer-local", name: "local", updated_at: "2026-02-01" } as Row,
      { id: "older-local", name: "local", updated_at: "2026-01-01" } as Row,
    ]);

    const delta = pipeline.applyWindows("rows", [
      window_([
        { id: "newer-local", name: "remote", updated_at: "2026-01-15" },
        { id: "older-local", name: "remote", updated_at: "2026-01-20" },
      ]),
    ]);

    expect(delta.upserts.map((r) => r.id)).toEqual(["older-local"]);
    expect((pool.get("newer-local") as Row).name).toBe("local");
    expect((pool.get("older-local") as Row).name).toBe("remote");
  });

  it("sweeps only rows inside the window scope", () => {
    const { pool, pipeline } = makeRig();
    pool.applyUpserts([
      { id: "normal-gone", internal: false } as Row,
      { id: "internal-kept", internal: true } as Row,
    ]);

    const delta = pipeline.applyWindows("rows", [
      window_([{ id: "normal-present", internal: false } as Row], {
        complete: true,
        matches: (row) => (row as Row).internal !== true,
      }),
    ]);

    expect(delta.deletes).toEqual(["normal-gone"]);
    expect(pool.get("internal-kept")).toBeDefined();
    expect(pool.get("normal-present")).toBeDefined();
  });

  it("never sweeps on a truncated window", () => {
    const { pool, pipeline } = makeRig();
    pool.applyUpserts([{ id: "outside-page" } as Row]);

    const delta = pipeline.applyWindows("rows", [
      window_([{ id: "in-page" } as Row], {
        complete: false,
        matches: () => true,
      }),
    ]);

    expect(delta.deletes).toEqual([]);
    expect(pool.get("outside-page")).toBeDefined();
  });

  it("short-circuits identical windows via content hash", () => {
    const { pool, pipeline } = makeRig();
    const rows = [{ id: "a", updated_at: "2026-01-01" }];

    const first = pipeline.applyWindows("rows", [window_(rows)]);
    expect(first.upserts).toHaveLength(1);

    pool.applyDeletes(["a"], { persist: false });
    const second = pipeline.applyWindows("rows", [window_(rows)]);

    // Unchanged payload: nothing re-applied, nothing swept.
    expect(second.upserts).toHaveLength(0);
    expect(second.deletes).toHaveLength(0);
  });

  it("drops rows that fail schema validation", () => {
    const { pipeline } = makeRig();
    const delta = pipeline.applyWindows("rows", [
      window_([
        { id: "ok" } as Row,
        { id: 42 } as unknown as Row, // invalid: id must be a string
      ]),
    ]);
    expect(delta.upserts.map((r) => r.id)).toEqual(["ok"]);
  });

  it("applyBroadcast updates pools without persisting", () => {
    const { pool, pipeline } = makeRig();
    const events: boolean[] = [];
    pool.changes.on("change", (change) => events.push(change.persist));

    pipeline.applyBroadcast({
      collection: "rows",
      upserts: [{ id: "from-leader" }],
      deletes: [],
    });

    expect(pool.get("from-leader")).toBeDefined();
    expect(events).toEqual([false]);
  });
});
