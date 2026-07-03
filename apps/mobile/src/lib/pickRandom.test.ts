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

  it.each([
    { randomValue: 0, expected: "a" },
    { randomValue: 0.99, expected: "d" },
  ])(
    "returns $expected when Math.random returns $randomValue",
    ({ randomValue, expected }) => {
      const pool = ["a", "b", "c", "d"];
      vi.spyOn(Math, "random").mockReturnValueOnce(randomValue);
      expect(pickRandom(pool)).toBe(expected);
    },
  );
});
