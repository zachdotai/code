import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ClientMocks,
  installFakeSession,
  makeClientMocks,
} from "../../test/helpers/claude-agent";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

vi.mock("./mcp/tool-metadata", () => ({
  fetchMcpToolMetadata: vi.fn().mockResolvedValue(undefined),
  getConnectedMcpServerNames: vi.fn().mockReturnValue([]),
  setMcpToolApprovalStates: vi.fn(),
  isMcpToolReadOnly: vi.fn().mockReturnValue(false),
  getMcpToolMetadata: vi.fn().mockReturnValue(undefined),
  getMcpToolApprovalState: vi.fn().mockReturnValue(undefined),
}));

const { ClaudeAcpAgent } = await import("./claude-agent");
type Agent = InstanceType<typeof ClaudeAcpAgent>;

function makeAgent(): { agent: Agent; client: ClientMocks } {
  const client = makeClientMocks();
  const agent = new ClaudeAcpAgent(client as unknown as AgentSideConnection);
  return { agent, client };
}

function findUnsupportedChunkText(
  calls: ClientMocks["sessionUpdate"]["mock"]["calls"],
): string | undefined {
  const match = calls.find(([call]) => {
    const update = (
      call as {
        update?: { sessionUpdate?: string; content?: { text?: string } };
      }
    ).update;
    return (
      update?.sessionUpdate === "agent_message_chunk" &&
      update?.content?.text?.toLowerCase().includes("unsupported")
    );
  });
  return (match?.[0] as { update: { content: { text: string } } } | undefined)
    ?.update.content.text;
}

describe("ClaudeAcpAgent.prompt — early idle handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const cases = [
    {
      label: "unsupported slash command surfaces error and ends turn",
      sessionId: "s-slash",
      prompt: "/plugin install slack",
      knownCommands: undefined,
      expectsUnsupportedChunk: true,
      commandInMessage: "/plugin",
    },
    {
      label: "non-slash prompt with early idle is silently skipped",
      sessionId: "s-regular",
      prompt: "hello",
      knownCommands: undefined,
      expectsUnsupportedChunk: false,
      commandInMessage: null,
    },
    {
      label:
        "newly installed skill command is refreshed before unsupported check",
      sessionId: "s-new-skill",
      prompt: "/local-test-skill",
      knownCommands: undefined,
      supportedCommandsAfterReload: [
        {
          name: "local-test-skill",
          description: "Local test skill",
          argumentHint: "",
        },
      ],
      expectsUnsupportedChunk: false,
      commandInMessage: null,
    },
    {
      label:
        "known plugin/skill command with early idle is not flagged as unsupported",
      sessionId: "s-skill",
      prompt: "/skills-store use my address pr review skill",
      knownCommands: new Set(["skills-store"]),
      expectsUnsupportedChunk: false,
      commandInMessage: null,
    },
  ] as const;

  it.each(cases)("$label", async (tc) => {
    const { agent, client } = makeAgent();
    const { query } = installFakeSession(
      agent,
      tc.sessionId,
      tc.knownCommands as Set<string> | undefined,
    );
    if ("supportedCommandsAfterReload" in tc) {
      vi.mocked(query.supportedCommands).mockResolvedValue([
        ...tc.supportedCommandsAfterReload,
      ]);
    }

    const promptPromise = agent.prompt({
      sessionId: tc.sessionId,
      prompt: [{ type: "text", text: tc.prompt }],
    });

    // Let the prompt loop start awaiting the first SDK message.
    await new Promise((resolve) => setImmediate(resolve));

    query._mockHelpers.sendMessage({
      type: "system",
      subtype: "session_state_changed",
      state: "idle",
    } as unknown as SDKMessage);
    query._mockHelpers.complete();

    if (tc.expectsUnsupportedChunk) {
      const result = await promptPromise;
      expect(result.stopReason).toBe("end_turn");

      const text = findUnsupportedChunkText(client.sessionUpdate.mock.calls);
      expect(text).toBeDefined();
      if (tc.commandInMessage) {
        expect(text).toContain(tc.commandInMessage);
      }
    } else {
      // No unsupported chunk; loop falls through to the existing
      // "Session did not end in result" failure path.
      await expect(promptPromise).rejects.toThrow(
        /Session did not end in result/,
      );
      expect(
        findUnsupportedChunkText(client.sessionUpdate.mock.calls),
      ).toBeUndefined();
      if ("supportedCommandsAfterReload" in tc) {
        expect(query.reloadSkills).toHaveBeenCalled();
        expect(query.supportedCommands).toHaveBeenCalled();
      }
    }
  });
});

describe("ClaudeAcpAgent.prompt — force-cancel backstop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'cancelled' when the SDK never yields after interrupt (issue #680)", async () => {
    const { agent } = makeAgent();
    const sessionId = "s-wedged";
    const { query } = installFakeSession(agent, sessionId);
    query.interrupt.mockImplementation(async () => {});
    (agent as unknown as { forceCancelGraceMs: number }).forceCancelGraceMs = 5;

    const promptPromise = agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "do something slow" }],
    });

    await new Promise((resolve) => setImmediate(resolve));

    await agent.cancel({ sessionId });

    const result = await promptPromise;
    expect(result.stopReason).toBe("cancelled");
  });

  it("clears the backstop timer on a healthy cancel (interrupt yields)", async () => {
    const { agent } = makeAgent();
    const sessionId = "s-healthy";
    installFakeSession(agent, sessionId);
    (agent as unknown as { forceCancelGraceMs: number }).forceCancelGraceMs =
      50_000;

    const promptPromise = agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "do something" }],
    });
    await new Promise((resolve) => setImmediate(resolve));

    await agent.cancel({ sessionId });

    const result = await promptPromise;
    expect(result.stopReason).toBe("cancelled");
    expect(
      (agent as unknown as { session: { forceCancelTimer?: unknown } }).session
        .forceCancelTimer,
    ).toBeUndefined();
  });
});
