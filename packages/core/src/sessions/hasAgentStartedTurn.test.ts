import type { AcpMessage } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import { createUserMessageEvent } from "./sessionEvents";
import { hasAgentStartedTurn } from "./sessionService";

function agentUpdate(
  sessionUpdate: string,
  ts: number,
  content?: { type: string },
): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate, ...(content ? { content } : {}) } },
    },
  } as AcpMessage;
}

describe("hasAgentStartedTurn", () => {
  it("is false while still optimistic (echo not landed)", () => {
    // A prior completed turn is present, but the just-sent prompt is still an
    // optimistic item — its echo has not landed, so the agent has not started.
    const events = [
      createUserMessageEvent("first", 1),
      agentUpdate("agent_message_chunk", 2, { type: "text" }),
    ];
    expect(hasAgentStartedTurn({ events, hasOptimisticItems: true })).toBe(
      false,
    );
  });

  it("is false with no events", () => {
    expect(hasAgentStartedTurn({ events: [], hasOptimisticItems: false })).toBe(
      false,
    );
  });

  it("is false when only the prompt echo has landed", () => {
    expect(
      hasAgentStartedTurn({
        events: [createUserMessageEvent("hi", 1)],
        hasOptimisticItems: false,
      }),
    ).toBe(false);
  });

  it.each([
    [
      "agent text chunk",
      agentUpdate("agent_message_chunk", 2, { type: "text" }),
    ],
    ["agent thought chunk", agentUpdate("agent_thought_chunk", 2)],
    ["tool call", agentUpdate("tool_call", 2)],
    ["tool call update", agentUpdate("tool_call_update", 2)],
  ])("is true after %s", (_label, output) => {
    expect(
      hasAgentStartedTurn({
        events: [createUserMessageEvent("hi", 1), output],
        hasOptimisticItems: false,
      }),
    ).toBe(true);
  });

  it("ignores output from a previous turn (looks only after the latest prompt)", () => {
    const events = [
      createUserMessageEvent("first", 1),
      agentUpdate("agent_message_chunk", 2, { type: "text" }),
      createUserMessageEvent("second", 3),
    ];
    expect(hasAgentStartedTurn({ events, hasOptimisticItems: false })).toBe(
      false,
    );
  });

  it("is true when the latest turn has output after an earlier turn", () => {
    const events = [
      createUserMessageEvent("first", 1),
      agentUpdate("agent_message_chunk", 2, { type: "text" }),
      createUserMessageEvent("second", 3),
      agentUpdate("tool_call", 4),
    ];
    expect(hasAgentStartedTurn({ events, hasOptimisticItems: false })).toBe(
      true,
    );
  });
});
