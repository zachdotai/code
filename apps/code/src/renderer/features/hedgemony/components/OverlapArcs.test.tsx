import type { Nest, Overlap } from "@main/services/hedgemony/schemas";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@utils/electronStorage", () => ({
  electronStorage: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import { useFederationStore } from "../stores/federationStore";
import { useNestStore } from "../stores/nestStore";
import { OverlapArcs } from "./OverlapArcs";

function makeNest(id: string, mapX: number, mapY: number): Nest {
  return {
    id,
    name: `nest-${id}`,
    goalPrompt: "",
    definitionOfDone: null,
    mapX,
    mapY,
    status: "active",
    health: "ok",
    targetMetricId: null,
    loadoutJson: null,
    primaryRepository: null,
    mergedIntoId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function makeOverlap(overrides: Partial<Overlap> & { id: string }): Overlap {
  return {
    id: overrides.id,
    nestAId: overrides.nestAId ?? "nest-a",
    nestBId: overrides.nestBId ?? "nest-b",
    kind: overrides.kind ?? "goal_embedding",
    score: overrides.score ?? 0.5,
    evidenceJson: overrides.evidenceJson ?? "{}",
    firstSeenAt: overrides.firstSeenAt ?? new Date(0).toISOString(),
    lastSeenAt: overrides.lastSeenAt ?? new Date(0).toISOString(),
    resolvedAt: overrides.resolvedAt ?? null,
  };
}

describe("OverlapArcs", () => {
  beforeEach(() => {
    useNestStore.setState({
      nests: {
        "nest-a": makeNest("nest-a", -200, 0),
        "nest-b": makeNest("nest-b", 200, 0),
        "nest-c": makeNest("nest-c", 0, 200),
      },
      hedgehogStateByNestId: {},
      loaded: true,
    });
    useFederationStore.setState({
      proposalsById: {},
      overlapsById: {},
      bridgesById: {},
      overlayVisible: false,
      lastReadAt: 0,
    });
  });

  it("renders nothing when the overlay is hidden", () => {
    useFederationStore.setState({
      overlayVisible: false,
      overlapsById: {
        "ov-1": makeOverlap({
          id: "ov-1",
          nestAId: "nest-a",
          nestBId: "nest-b",
        }),
      },
    });

    const { container, queryByTestId } = render(<OverlapArcs />);
    expect(queryByTestId("overlap-arcs")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders one path per active overlap when the overlay is visible", () => {
    useFederationStore.setState({
      overlayVisible: true,
      overlapsById: {
        "ov-1": makeOverlap({
          id: "ov-1",
          nestAId: "nest-a",
          nestBId: "nest-b",
        }),
        "ov-2": makeOverlap({
          id: "ov-2",
          nestAId: "nest-a",
          nestBId: "nest-c",
          kind: "pr_graph",
        }),
      },
    });

    const { container } = render(<OverlapArcs />);
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(2);
    const ids = Array.from(paths)
      .map((p) => p.getAttribute("data-overlap-id"))
      .sort();
    expect(ids).toEqual(["ov-1", "ov-2"]);
  });

  it("skips resolved overlaps", () => {
    useFederationStore.setState({
      overlayVisible: true,
      overlapsById: {
        "ov-open": makeOverlap({
          id: "ov-open",
          nestAId: "nest-a",
          nestBId: "nest-b",
        }),
        "ov-done": makeOverlap({
          id: "ov-done",
          nestAId: "nest-a",
          nestBId: "nest-c",
          resolvedAt: new Date().toISOString(),
        }),
      },
    });

    const { container } = render(<OverlapArcs />);
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute("data-overlap-id")).toBe("ov-open");
  });

  it("scales stroke opacity with score", () => {
    useFederationStore.setState({
      overlayVisible: true,
      overlapsById: {
        "ov-low": makeOverlap({
          id: "ov-low",
          nestAId: "nest-a",
          nestBId: "nest-b",
          score: 0,
        }),
        "ov-high": makeOverlap({
          id: "ov-high",
          nestAId: "nest-a",
          nestBId: "nest-c",
          score: 1,
        }),
      },
    });

    const { container } = render(<OverlapArcs />);
    const low = container.querySelector('path[data-overlap-id="ov-low"]');
    const high = container.querySelector('path[data-overlap-id="ov-high"]');
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    const lowOpacity = Number(low?.getAttribute("stroke-opacity"));
    const highOpacity = Number(high?.getAttribute("stroke-opacity"));
    expect(highOpacity).toBeGreaterThan(lowOpacity);
  });

  it("never receives pointer events on its overlay group", () => {
    useFederationStore.setState({
      overlayVisible: true,
      overlapsById: {
        "ov-1": makeOverlap({
          id: "ov-1",
          nestAId: "nest-a",
          nestBId: "nest-b",
        }),
      },
    });

    const { getByTestId } = render(<OverlapArcs />);
    const group = getByTestId("overlap-arcs");
    expect(group.className).toContain("pointer-events-none");
  });
});
