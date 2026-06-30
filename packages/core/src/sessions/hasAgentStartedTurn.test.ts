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
  it.each<[string, AcpMessage[], boolean]>([
    // A prior completed turn is present, but the just-sent prompt is still an
    // optimistic item — its echo has not landed, so the agent has not started.
    [
      "still optimistic (echo not landed)",
      [
        createUserMessageEvent("first", 1),
        agentUpdate("agent_message_chunk", 2, { type: "text" }),
      ],
      true,
    ],
    ["there are no events", [], false],
    [
      "only the prompt echo has landed",
      [createUserMessageEvent("hi", 1)],
      false,
    ],
  ])("is false when %s", (_label, events, hasOptimisticItems) => {
    expect(hasAgentStartedTurn({ events, hasOptimisticItems })).toBe(false);
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

  it.each<[string, AcpMessage[], boolean]>([
    // Only looks after the latest prompt: the prior turn's output is ignored.
    [
      "prior turn has output but the latest prompt does not",
      [
        createUserMessageEvent("first", 1),
        agentUpdate("agent_message_chunk", 2, { type: "text" }),
        createUserMessageEvent("second", 3),
      ],
      false,
    ],
    [
      "the latest turn has output after an earlier turn",
      [
        createUserMessageEvent("first", 1),
        agentUpdate("agent_message_chunk", 2, { type: "text" }),
        createUserMessageEvent("second", 3),
        agentUpdate("tool_call", 4),
      ],
      true,
    ],
  ])("turn isolation: %s", (_label, events, expected) => {
    expect(hasAgentStartedTurn({ events, hasOptimisticItems: false })).toBe(
      expected,
    );
  });
});
