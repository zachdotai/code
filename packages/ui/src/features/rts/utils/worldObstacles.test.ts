import { describe, expect, it } from "vitest";
import { HOGLET_RADIUS, hogletObstacles } from "./worldObstacles";

describe("hogletObstacles", () => {
  it("turns visible hoglet positions into unit collision obstacles", () => {
    expect(
      hogletObstacles([
        { hogletId: "hg-1", x: 10, y: 20 },
        { hogletId: "hg-2", x: -30, y: 40 },
      ]),
    ).toEqual([
      { x: 10, y: 20, radius: HOGLET_RADIUS },
      { x: -30, y: 40, radius: HOGLET_RADIUS },
    ]);
  });

  it("excludes moving hoglets from their own obstacle set", () => {
    expect(
      hogletObstacles(
        [
          { hogletId: "moving", x: 0, y: 0 },
          { hogletId: "blocking", x: 50, y: 0 },
        ],
        new Set(["moving"]),
      ),
    ).toEqual([{ x: 50, y: 0, radius: HOGLET_RADIUS }]);
  });
});
