import { afterEach, describe, expect, it, vi } from "vitest";
import { pickRandom } from "./pickRandom";

describe("pickRandom", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("always returns an element from the pool", () => {
    const pool = ["a", "b", "c", "d"];
    for (let i = 0; i < 50; i++) {
      expect(pool).toContain(pickRandom(pool));
    }
  });

  it("draws a fresh pick from the random value on each call", () => {
    const pool = ["a", "b", "c", "d"];
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.99);
    expect(pickRandom(pool)).toBe("a");
    expect(pickRandom(pool)).toBe("d");
  });
});
