import { describe, expect, it, vi } from "vitest";
import { createEntityPool } from "./poolStore";

interface Fish {
  id: string;
  name: string;
  updated_at?: string | null;
}

describe("createEntityPool", () => {
  it("upserts preserve insertion order and normalize by id", () => {
    const pool = createEntityPool<Fish>("fish");
    pool.applyUpserts([
      { id: "a", name: "Ahi" },
      { id: "b", name: "Bass" },
    ]);
    pool.applyUpserts([{ id: "a", name: "Ahi 2" }]);

    expect(pool.store.getState().ids).toEqual(["a", "b"]);
    expect(pool.get("a")?.name).toBe("Ahi 2");
    expect(pool.getAll().map((f) => f.name)).toEqual(["Ahi 2", "Bass"]);
  });

  it("deletes remove ids and entities, ignoring unknown ids", () => {
    const pool = createEntityPool<Fish>("fish");
    pool.applyUpserts([
      { id: "a", name: "Ahi" },
      { id: "b", name: "Bass" },
    ]);

    pool.applyDeletes(["a", "missing"]);

    expect(pool.store.getState().ids).toEqual(["b"]);
    expect(pool.get("a")).toBeUndefined();
  });

  it("emits change events with the persist flag", () => {
    const pool = createEntityPool<Fish>("fish");
    const seen: Array<{ upserts: number; deletes: number; persist: boolean }> =
      [];
    pool.changes.on("change", (change) => {
      seen.push({
        upserts: change.upserts.length,
        deletes: change.deletes.length,
        persist: change.persist,
      });
    });

    pool.applyUpserts([{ id: "a", name: "Ahi" }]);
    pool.applyUpserts([{ id: "b", name: "Bass" }], { persist: false });
    pool.applyDeletes(["a"]);

    expect(seen).toEqual([
      { upserts: 1, deletes: 0, persist: true },
      { upserts: 1, deletes: 0, persist: false },
      { upserts: 0, deletes: 1, persist: true },
    ]);
  });

  it("replaceAll swaps contents without emitting a change event", () => {
    const pool = createEntityPool<Fish>("fish");
    const listener = vi.fn();
    pool.changes.on("change", listener);

    pool.applyUpserts([{ id: "old", name: "Old" }]);
    listener.mockClear();

    pool.replaceAll([
      { id: "a", name: "Ahi" },
      { id: "b", name: "Bass" },
    ]);

    expect(listener).not.toHaveBeenCalled();
    expect(pool.store.getState().ids).toEqual(["a", "b"]);
    expect(pool.store.getState().hydrated).toBe(false);

    pool.markHydrated();
    expect(pool.store.getState().hydrated).toBe(true);
  });

  it("narrow selectors do not fire for unrelated entity changes", () => {
    const pool = createEntityPool<Fish>("fish");
    pool.applyUpserts([
      { id: "a", name: "Ahi" },
      { id: "b", name: "Bass" },
    ]);

    const aListener = vi.fn();
    pool.store.subscribe((state) => state.entities.a, aListener);

    pool.applyUpserts([{ id: "b", name: "Bass 2" }]);
    expect(aListener).not.toHaveBeenCalled();

    pool.applyUpserts([{ id: "a", name: "Ahi 2" }]);
    expect(aListener).toHaveBeenCalledTimes(1);
  });

  it("clear resets contents and hydration", () => {
    const pool = createEntityPool<Fish>("fish");
    pool.applyUpserts([{ id: "a", name: "Ahi" }]);
    pool.markHydrated();

    pool.clear();

    expect(pool.store.getState()).toMatchObject({
      ids: [],
      entities: {},
      hydrated: false,
    });
  });
});
