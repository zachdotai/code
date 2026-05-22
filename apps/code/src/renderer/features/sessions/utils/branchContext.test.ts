import type { AcpMessage } from "@shared/types/session-events";
import { describe, expect, it } from "vitest";
import { buildBranchTranscript } from "./branchContext";

function userPromptMsg(ts: number, id: number, text: string): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      id,
      method: "session/prompt",
      params: { prompt: [{ type: "text", text }] },
    },
  };
}

function agentMessageMsg(ts: number, text: string): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      },
    },
  };
}

describe("buildBranchTranscript", () => {
  it("returns empty result for no events", () => {
    expect(buildBranchTranscript([])).toEqual({
      transcript: "",
      turnCount: 0,
      truncated: false,
    });
  });

  it("includes user and assistant turns", () => {
    const events = [
      userPromptMsg(1, 1, "Fix the login bug"),
      agentMessageMsg(2, "I found the issue in auth.ts"),
    ];

    const result = buildBranchTranscript(events);

    expect(result.turnCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.transcript).toContain("## User");
    expect(result.transcript).toContain("Fix the login bug");
    expect(result.transcript).toContain("## Assistant");
    expect(result.transcript).toContain("I found the issue in auth.ts");
  });

  it("counts multiple user turns", () => {
    const events = [
      userPromptMsg(1, 1, "First request"),
      agentMessageMsg(2, "Done"),
      userPromptMsg(3, 2, "Second request"),
    ];

    expect(buildBranchTranscript(events).turnCount).toBe(2);
  });

  it("truncates oldest turns when over the character budget", () => {
    const huge = "x".repeat(5_000);
    const events: AcpMessage[] = [];
    for (let i = 0; i < 20; i++) {
      events.push(userPromptMsg(i * 2 + 1, i + 1, `prompt ${i}`));
      events.push(agentMessageMsg(i * 2 + 2, huge));
    }

    const result = buildBranchTranscript(events);

    expect(result.truncated).toBe(true);
    expect(result.transcript.startsWith("_(earlier turns omitted)_")).toBe(
      true,
    );
    // Most recent turn must survive truncation.
    expect(result.transcript).toContain("prompt 19");
  });
});
