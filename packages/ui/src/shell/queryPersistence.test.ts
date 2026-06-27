import { describe, expect, it } from "vitest";
import { shouldPersistCanvasQuery } from "./queryPersistence";

type PredicateArg = Parameters<typeof shouldPersistCanvasQuery>[0];

// Minimal Query stand-in: the predicate only reads `queryKey` and
// `state.status`.
function fakeQuery(queryKey: unknown, status = "success"): PredicateArg {
  return { queryKey, state: { status } } as unknown as PredicateArg;
}

describe("shouldPersistCanvasQuery", () => {
  it("persists the channels list", () => {
    expect(shouldPersistCanvasQuery(fakeQuery(["canvas-channels"]))).toBe(true);
  });

  it("persists tRPC dashboards.list and dashboards.get", () => {
    expect(
      shouldPersistCanvasQuery(
        fakeQuery([["dashboards", "list"], { input: {}, type: "query" }]),
      ),
    ).toBe(true);
    expect(
      shouldPersistCanvasQuery(
        fakeQuery([["dashboards", "get"], { input: {}, type: "query" }]),
      ),
    ).toBe(true);
  });

  it("persists tRPC channelTasks.list", () => {
    expect(
      shouldPersistCanvasQuery(
        fakeQuery([["channelTasks", "list"], { input: {}, type: "query" }]),
      ),
    ).toBe(true);
  });

  it("does not persist non-canvas queries", () => {
    expect(
      shouldPersistCanvasQuery(fakeQuery(["auth", "current-user", "us:2"])),
    ).toBe(false);
    expect(
      shouldPersistCanvasQuery(
        fakeQuery([["sessions", "list"], { input: {}, type: "query" }]),
      ),
    ).toBe(false);
    expect(
      shouldPersistCanvasQuery(
        fakeQuery([["dashboards", "saveFreeform"], { input: {} }]),
      ),
    ).toBe(false);
  });

  it("does not persist queries that have not succeeded", () => {
    expect(
      shouldPersistCanvasQuery(fakeQuery(["canvas-channels"], "pending")),
    ).toBe(false);
    expect(
      shouldPersistCanvasQuery(fakeQuery(["canvas-channels"], "error")),
    ).toBe(false);
  });
});
