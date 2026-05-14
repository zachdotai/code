import type { Bridge, Nest, Overlap } from "@main/services/hedgemony/schemas";
import { Theme } from "@radix-ui/themes";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@utils/electronStorage", () => ({
  electronStorage: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

const removeBridgeMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../hooks/useFederation", () => ({
  useFederation: vi.fn(),
}));

import { useFederation } from "../../hooks/useFederation";
import { useNestStore } from "../../stores/nestStore";
import { FederationSubsection } from "./FederationSubsection";

const mockedUseFederation = vi.mocked(useFederation);

function makeNest(id: string, name?: string): Nest {
  return {
    id,
    name: name ?? `nest-${id}`,
    goalPrompt: "",
    definitionOfDone: null,
    mapX: 0,
    mapY: 0,
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
    score: overrides.score ?? 0.42,
    evidenceJson: overrides.evidenceJson ?? "{}",
    firstSeenAt: overrides.firstSeenAt ?? new Date().toISOString(),
    lastSeenAt: overrides.lastSeenAt ?? new Date().toISOString(),
    resolvedAt: overrides.resolvedAt ?? null,
  };
}

function makeBridge(overrides: Partial<Bridge> & { id: string }): Bridge {
  return {
    id: overrides.id,
    nestAId: overrides.nestAId ?? "nest-a",
    nestBId: overrides.nestBId ?? "nest-b",
    kind: overrides.kind ?? "signal_forward",
    payloadJson: overrides.payloadJson ?? "{}",
    createdBy: overrides.createdBy ?? "builder",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    removedAt: overrides.removedAt ?? null,
  };
}

function withTheme(node: ReactNode) {
  return <Theme>{node}</Theme>;
}

const baseApi = {
  openProposals: [],
  unreadCount: 0,
  overlayVisible: false,
  acceptProposal: vi.fn(),
  dismissProposal: vi.fn(),
  snoozeProposal: vi.fn(),
  createBridge: vi.fn(),
  mergeNests: vi.fn(),
  splitNest: vi.fn(),
  toggleOverlay: vi.fn(),
  markNoticesRead: vi.fn(),
};

describe("FederationSubsection", () => {
  beforeEach(() => {
    removeBridgeMock.mockClear();
    mockedUseFederation.mockReset();
    useNestStore.setState({
      nests: {
        "nest-a": makeNest("nest-a", "Alpha"),
        "nest-b": makeNest("nest-b", "Beta"),
        "nest-c": makeNest("nest-c", "Gamma"),
      },
      hedgehogStateByNestId: {},
      loaded: true,
    });
  });

  it("renders empty states when there is no overlap or bridge activity", () => {
    mockedUseFederation.mockReturnValue({
      ...baseApi,
      overlapsForNest: [],
      bridgesForNest: [],
      removeBridge: removeBridgeMock,
    });

    render(withTheme(<FederationSubsection nestId="nest-a" />));

    fireEvent.click(screen.getByRole("button", { name: /Federation/ }));

    expect(screen.getByText(/No active overlaps/i)).toBeInTheDocument();
    expect(screen.getByText(/No outbound bridges/i)).toBeInTheDocument();
  });

  it("renders overlap rows with sibling name and kind label", () => {
    mockedUseFederation.mockReturnValue({
      ...baseApi,
      overlapsForNest: [
        makeOverlap({
          id: "ov-1",
          nestAId: "nest-a",
          nestBId: "nest-b",
          kind: "goal_embedding",
        }),
        makeOverlap({
          id: "ov-2",
          nestAId: "nest-c",
          nestBId: "nest-a",
          kind: "pr_graph",
        }),
      ],
      bridgesForNest: [],
      removeBridge: removeBridgeMock,
    });

    render(withTheme(<FederationSubsection nestId="nest-a" />));
    fireEvent.click(screen.getByRole("button", { name: /Federation/ }));

    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
    expect(screen.getByText("goal overlap")).toBeInTheDocument();
    expect(screen.getByText("PR graph")).toBeInTheDocument();
  });

  it("calls removeBridge with the right id when Remove is clicked", async () => {
    mockedUseFederation.mockReturnValue({
      ...baseApi,
      overlapsForNest: [],
      bridgesForNest: [
        makeBridge({
          id: "bridge-1",
          nestAId: "nest-a",
          nestBId: "nest-b",
          kind: "signal_forward",
          createdBy: "operator",
        }),
        makeBridge({
          id: "bridge-2",
          nestAId: "nest-a",
          nestBId: "nest-c",
          kind: "scratchpad_ref",
          createdBy: "builder",
        }),
      ],
      removeBridge: removeBridgeMock,
    });

    render(withTheme(<FederationSubsection nestId="nest-a" />));
    fireEvent.click(screen.getByRole("button", { name: /Federation/ }));

    const removeForBeta = screen.getByLabelText(/Remove bridge to Beta/);
    fireEvent.click(removeForBeta);

    expect(removeBridgeMock).toHaveBeenCalledTimes(1);
    expect(removeBridgeMock).toHaveBeenCalledWith("bridge-1");
  });

  it("only lists outbound bridges (nest is nest_a)", () => {
    mockedUseFederation.mockReturnValue({
      ...baseApi,
      overlapsForNest: [],
      bridgesForNest: [
        makeBridge({
          id: "outbound-1",
          nestAId: "nest-a",
          nestBId: "nest-b",
        }),
        makeBridge({
          id: "inbound-1",
          nestAId: "nest-c",
          nestBId: "nest-a",
        }),
      ],
      removeBridge: removeBridgeMock,
    });

    render(withTheme(<FederationSubsection nestId="nest-a" />));
    fireEvent.click(screen.getByRole("button", { name: /Federation/ }));

    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Gamma")).toBeNull();
  });
});
