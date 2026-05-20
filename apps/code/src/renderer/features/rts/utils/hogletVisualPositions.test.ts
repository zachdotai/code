import { afterEach, describe, expect, it } from "vitest";
import {
  applyHogletVisualPositions,
  clearHogletVisualPositionsForTest,
  getHogletVisualPosition,
  setHogletVisualPositionForTest,
} from "./hogletVisualPositions";

describe("hogletVisualPositions", () => {
  afterEach(() => {
    clearHogletVisualPositionsForTest();
  });

  it("overlays live sprite positions over persisted target positions", () => {
    setHogletVisualPositionForTest("hg-1", { x: 25, y: 30 });

    expect(
      applyHogletVisualPositions([
        { hogletId: "hg-1", x: 100, y: 100 },
        { hogletId: "hg-2", x: 200, y: 200 },
      ]),
    ).toEqual([
      { hogletId: "hg-1", x: 25, y: 30 },
      { hogletId: "hg-2", x: 200, y: 200 },
    ]);
  });

  it("returns clones so callers cannot mutate the registry", () => {
    setHogletVisualPositionForTest("hg-1", { x: 1, y: 2 });

    const pos = getHogletVisualPosition("hg-1");
    if (!pos) throw new Error("expected position");
    pos.x = 999;

    expect(getHogletVisualPosition("hg-1")).toEqual({ x: 1, y: 2 });
  });
});
