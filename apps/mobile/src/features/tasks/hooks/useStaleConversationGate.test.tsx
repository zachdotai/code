import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseUserQuery = vi.fn();
vi.mock("@/features/auth", () => ({
  useUserQuery: () => mockUseUserQuery(),
}));

import { useStaleConversationGateStore } from "../stores/staleConversationGateStore";
import type { SessionEvent } from "../types";
import {
  type StaleConversationGate,
  useStaleConversationGate,
} from "./useStaleConversationGate";

// ts=1 is effectively epoch, so `now - lastActivityAt` is always well past the
// 60-minute stale bound.
function usageEvent(used: number, ts = 1): SessionEvent {
  return {
    type: "session_update",
    ts,
    notification: {
      update: { sessionUpdate: "usage_update", used, size: 1_000_000 },
    },
  };
}

function freshEvent(ts: number): SessionEvent {
  return { type: "acp_message", direction: "agent", ts, message: {} };
}

function render(taskId: string, events: SessionEvent[]) {
  let gate: StaleConversationGate | undefined;
  function Harness() {
    gate = useStaleConversationGate(taskId, events);
    return null;
  }
  let renderer: ReturnType<typeof create> | null = null;
  act(() => {
    renderer = create(createElement(Harness));
  });
  return {
    get gate() {
      if (!gate) throw new Error("gate not captured");
      return gate;
    },
    rerender(next: SessionEvent[]) {
      events = next;
      act(() => {
        renderer?.update(createElement(Harness));
      });
    },
  };
}

describe("useStaleConversationGate", () => {
  beforeEach(() => {
    useStaleConversationGateStore.setState({
      engagedSessions: new Map(),
      acknowledgedSessions: new Set(),
    });
    mockUseUserQuery.mockReset();
  });

  it("engages for staff on a large, stale conversation", () => {
    mockUseUserQuery.mockReturnValue({ data: { is_staff: true } });
    const { gate } = render("t1", [usageEvent(150_000)]);
    expect(gate.active).toBe(true);
    expect(gate.usedTokens).toBe(150_000);
  });

  it("never engages for non-staff", () => {
    mockUseUserQuery.mockReturnValue({ data: { is_staff: false } });
    const { gate } = render("t1", [usageEvent(150_000)]);
    expect(gate.active).toBe(false);
    expect(useStaleConversationGateStore.getState().engagedSessions.size).toBe(
      0,
    );
  });

  it("stays engaged when reconnect events make the conversation look fresh", () => {
    mockUseUserQuery.mockReturnValue({ data: { is_staff: true } });
    const view = render("t1", [usageEvent(150_000)]);
    expect(view.gate.active).toBe(true);
    view.rerender([usageEvent(150_000), freshEvent(Date.now())]);
    expect(view.gate.active).toBe(true);
  });

  it("releases the gate once acknowledged", () => {
    mockUseUserQuery.mockReturnValue({ data: { is_staff: true } });
    const view = render("t1", [usageEvent(150_000)]);
    act(() => {
      view.gate.onContinue();
    });
    expect(view.gate.active).toBe(false);
  });
});
