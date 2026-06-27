import { describe, expect, it } from "vitest";
import { shouldPersistCanvasQuery } from "./queryPersistence";

type PredicateArg = Parameters<typeof shouldPersistCanvasQuery>[0];

// Minimal Query stand-in: the predicate only reads `queryKey` and
// `state.status`.
function fakeQuery(queryKey: unknown, status = "success"): PredicateArg {
  return { queryKey, state: { status } } as unknown as PredicateArg;
}

describe("shouldPersistCanvasQuery", () => {
  it.each([
    { name: "channels list", key: ["canvas-channels"], expected: true },
    {
      name: "dashboards.list",
      key: [["dashboards", "list"], { input: {}, type: "query" }],
      expected: true,
    },
    {
      name: "dashboards.get",
      key: [["dashboards", "get"], { input: {}, type: "query" }],
      expected: true,
    },
    {
      name: "channelTasks.list",
      key: [["channelTasks", "list"], { input: {}, type: "query" }],
      expected: true,
    },
    {
      name: "auth current-user",
      key: ["auth", "current-user", "us:2"],
      expected: false,
    },
    {
      name: "sessions.list",
      key: [["sessions", "list"], { input: {}, type: "query" }],
      expected: false,
    },
    {
      name: "dashboards.saveFreeform (mutation-shaped)",
      key: [["dashboards", "saveFreeform"], { input: {} }],
      expected: false,
    },
  ])("$name → $expected", ({ key, expected }) => {
    expect(shouldPersistCanvasQuery(fakeQuery(key))).toBe(expected);
  });

  it.each(["pending", "error"])(
    "does not persist a canvas query in %s state",
    (status) => {
      expect(
        shouldPersistCanvasQuery(fakeQuery(["canvas-channels"], status)),
      ).toBe(false);
    },
  );
});
