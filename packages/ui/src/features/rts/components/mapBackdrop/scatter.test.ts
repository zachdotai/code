import type { Nest } from "@posthog/host-router/rts-schemas";
import { describe, expect, it } from "vitest";
import { scatterProps } from "./scatter";

function makeNest(id: string, mapX: number, mapY: number): Nest {
  return {
    id,
    name: id,
    goalPrompt: "",
    definitionOfDone: null,
    mapX,
    mapY,
    status: "active",
    health: "ok",
    targetMetricId: null,
    loadoutJson: null,
    primaryRepository: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const nests: Nest[] = [
  makeNest("nest-1", 240, -120),
  makeNest("nest-2", -480, 300),
];

describe("scatterProps", () => {
  it("produces the same output across calls with the same nests", () => {
    const first = scatterProps(nests);
    const second = scatterProps(nests);
    expect(second).toEqual(first);
  });

  it("produces a non-empty deterministic scatter", () => {
    const result = scatterProps([]);
    expect(result.length).toBeGreaterThan(0);
    expect(scatterProps([])).toEqual(result);
  });
});
