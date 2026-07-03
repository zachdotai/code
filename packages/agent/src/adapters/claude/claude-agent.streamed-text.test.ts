import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assistantMessage,
  type ClientMocks,
  echoUserMessage,
  installFakeSession,
  makeClientMocks,
  messageChunkTexts,
  resultSuccess,
  send,
  tick,
} from "../../test/helpers/claude-agent";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

vi.mock("./mcp/tool-metadata", () => ({
  fetchMcpToolMetadata: vi.fn().mockResolvedValue(undefined),
  getConnectedMcpServerNames: vi.fn().mockReturnValue([]),
  getCachedMcpTools: vi.fn().mockReturnValue([]),
  clearMcpToolMetadataCache: vi.fn(),
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

// Mark the session as having an enabled (but currently disconnected) in-process
// signed-commit server so the pre-prompt heal has something to reconnect.
function enableSignedCommitServer(agent: Agent): void {
  const session = (
    agent as unknown as {
      session: {
        buildInProcessMcpServers: () => Record<string, unknown>;
        localToolsServerNames: string[];
      };
    }
  ).session;
  session.localToolsServerNames = ["posthog-code-tools"];
  session.buildInProcessMcpServers = () => ({
    "posthog-code-tools": {
      type: "sdk",
      name: "posthog-code-tools",
      instance: {},
    },
  });
}

function messageStart(sessionId: string, apiId: string) {
  return {
    type: "stream_event",
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: `start-${apiId}`,
    event: { type: "message_start", message: { id: apiId, usage: {} } },
  };
}

function textDelta(sessionId: string, text: string) {
  return {
    type: "stream_event",
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: `delta-${text}`,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
  };
}

describe("ClaudeAcpAgent.prompt — streamed assistant text wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits streamed text once and drops the assembled duplicate", async () => {
    const { agent, client } = makeAgent();
    const sessionId = "s-streamed";
    const { query, input } = installFakeSession(agent, sessionId);

    const promptPromise = agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
    });
    await tick();

    await echoUserMessage(query, input);
    await send(query, messageStart(sessionId, "msg_1"));
    await send(query, textDelta(sessionId, "hello"));
    await send(query, assistantMessage(sessionId, "msg_1", "hello"));
    await send(query, resultSuccess(sessionId));

    const result = await promptPromise;
    expect(result.stopReason).toBe("end_turn");
    expect(messageChunkTexts(client.sessionUpdate.mock.calls)).toEqual([
      "hello",
    ]);
  });

  it("forwards assembled text when no deltas streamed (gateway path)", async () => {
    const { agent, client } = makeAgent();
    const sessionId = "s-gateway";
    const { query, input } = installFakeSession(agent, sessionId);

    const promptPromise = agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
    });
    await tick();

    await echoUserMessage(query, input);
    await send(query, assistantMessage(sessionId, "msg_2", "gateway answer"));
    await send(query, resultSuccess(sessionId));

    const result = await promptPromise;
    expect(result.stopReason).toBe("end_turn");
    expect(messageChunkTexts(client.sessionUpdate.mock.calls)).toEqual([
      "gateway answer",
    ]);
  });

  it("reconnects a disconnected signed-commit server before the turn", async () => {
    const { agent } = makeAgent();
    const sessionId = "s-heal";
    const { query, input } = installFakeSession(agent, sessionId);

    // Signed-commit server is enabled but the live query reports it absent.
    enableSignedCommitServer(agent);
    (query.mcpServerStatus as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "posthog-code-tools", status: "failed" },
    ]);

    const promptPromise = agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "commit this" }],
    });
    await tick();

    // The pre-prompt heal fired before the model turn began.
    expect(query.mcpServerStatus).toHaveBeenCalled();
    expect(query.setMcpServers).toHaveBeenCalledTimes(1);
    const arg = (query.setMcpServers as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(arg["posthog-code-tools"]).toMatchObject({ type: "sdk" });

    await echoUserMessage(query, input);
    await send(query, assistantMessage(sessionId, "msg_h", "done"));
    await send(query, resultSuccess(sessionId));
    const result = await promptPromise;
    expect(result.stopReason).toBe("end_turn");
  });

  it("skips the pre-prompt heal for local-only commands", async () => {
    const { agent } = makeAgent();
    const sessionId = "s-local-only";
    const { query } = installFakeSession(agent, sessionId);

    enableSignedCommitServer(agent);

    const promptPromise = agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "/context" }],
    });
    await tick();

    expect(query.mcpServerStatus).not.toHaveBeenCalled();
    expect(query.setMcpServers).not.toHaveBeenCalled();

    await send(query, resultSuccess(sessionId));
    await promptPromise;
  });
});
