import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdate = vi.hoisted(() => vi.fn());
const mockClient = vi.hoisted(() => ({ updateAgentApplication: mockUpdate }));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockSetPendingSecret = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));
vi.mock("@posthog/ui/features/auth/authClient", () => ({
  useAuthenticatedClient: () => mockClient,
}));
vi.mock("../../auth/store", () => ({
  useAuthStateValue: (selector: (s: { currentProjectId: number }) => unknown) =>
    selector({ currentProjectId: 1 }),
}));
vi.mock("./agentBuilderStore", () => ({
  useAgentBuilderStore: (
    selector: (s: {
      followMode: boolean;
      setPendingSecret: (...args: unknown[]) => unknown;
      page: { kind: string };
    }) => unknown,
  ) =>
    selector({
      followMode: true,
      setPendingSecret: mockSetPendingSecret,
      page: { kind: "agent-list" },
    }),
}));

import { useAgentBuilderClientTools } from "./useAgentBuilderClientTools";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function call(toolId: string, args: Record<string, unknown>) {
  return { call_id: "c1", tool_id: toolId, args };
}

describe("useAgentBuilderClientTools — set_application_description", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls updateAgentApplication and returns success on the happy path", async () => {
    mockUpdate.mockResolvedValue({});
    const { result } = renderHook(() => useAgentBuilderClientTools(), {
      wrapper,
    });
    const outcome = await result.current(
      call("set_application_description", {
        agent_slug: "support",
        description: "  Handles tier-1 support tickets.  ",
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith("support", {
      description: "Handles tier-1 support tickets.",
    });
    expect(outcome).toEqual({ result: { success: true } });
  });

  it("errors when agent_slug is missing", async () => {
    const { result } = renderHook(() => useAgentBuilderClientTools(), {
      wrapper,
    });
    const outcome = await result.current(
      call("set_application_description", { description: "ok" }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(outcome).toEqual({ error: "missing_arg: agent_slug" });
  });

  it("errors when description is missing", async () => {
    const { result } = renderHook(() => useAgentBuilderClientTools(), {
      wrapper,
    });
    const outcome = await result.current(
      call("set_application_description", { agent_slug: "support" }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(outcome).toEqual({ error: "missing_arg: description" });
  });

  it("rejects when the trimmed description exceeds the cap", async () => {
    const { result } = renderHook(() => useAgentBuilderClientTools(), {
      wrapper,
    });
    const outcome = await result.current(
      call("set_application_description", {
        agent_slug: "support",
        description: "x".repeat(281),
      }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(outcome).toEqual({ error: "description_too_long: max 280 chars" });
  });

  it("reports update_failed when the client throws", async () => {
    mockUpdate.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useAgentBuilderClientTools(), {
      wrapper,
    });
    const outcome = await result.current(
      call("set_application_description", {
        agent_slug: "support",
        description: "ok",
      }),
    );
    expect(outcome).toEqual({ error: "update_failed: boom" });
  });
});
