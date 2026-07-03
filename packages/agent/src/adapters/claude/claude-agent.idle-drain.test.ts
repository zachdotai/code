import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type {
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockQuery, type MockQuery } from "../../test/mocks/claude-sdk";
import { Pushable } from "../../utils/streams";

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

interface ClientMocks {
  sessionUpdate: ReturnType<typeof vi.fn>;
  extNotification: ReturnType<typeof vi.fn>;
}

function makeAgent(): { agent: Agent; client: ClientMocks } {
  const client: ClientMocks = {
    sessionUpdate: vi.fn().mockResolvedValue(undefined),
    extNotification: vi.fn().mockResolvedValue(undefined),
  };
  const agent = new ClaudeAcpAgent(client as unknown as AgentSideConnection);
  return { agent, client };
}

function installFakeSession(
  agent: Agent,
  sessionId: string,
): { query: MockQuery; input: Pushable<SDKUserMessage> } {
  const query = createMockQuery();
  const input = new Pushable<SDKUserMessage>();
  const abortController = new AbortController();

  const session = {
    query,
    queryOptions: { sessionId, cwd: "/tmp/repo", abortController },
    buildInProcessMcpServers: () => ({}),
    localToolsServerNames: [] as string[],
    input,
    cancelled: false,
    interruptReason: undefined,
    settingsManager: { dispose: vi.fn(), getRepoRoot: () => "/tmp/repo" },
    permissionMode: "default" as const,
    abortController,
    accumulatedUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
    },
    sessionResources: new Set(),
    configOptions: [],
    promptRunning: false,
    pendingMessages: new Map(),
    nextPendingOrder: 0,
    cwd: "/tmp/repo",
    notificationHistory: [] as unknown[],
    taskRunId: "run-1",
    lastContextWindowSize: 200_000,
    modelId: "claude-sonnet-4-6",
    taskState: new Map(),
  };

  (agent as unknown as { session: typeof session }).session = session;
  (agent as unknown as { sessionId: string }).sessionId = sessionId;

  return { query, input };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function send(query: MockQuery, message: unknown): Promise<void> {
  query._mockHelpers.sendMessage(message as SDKMessage);
  await tick();
}

// Replays the prompt's own user message back through the query so
// `promptReplayed` flips and the terminal `result` is not skipped.
async function echoUserMessage(
  query: MockQuery,
  input: Pushable<SDKUserMessage>,
): Promise<void> {
  const { value: pushed } = await input[Symbol.asyncIterator]().next();
  await send(query, pushed);
}

function assistantMessage(sessionId: string, apiId: string, text: string) {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    session_id: sessionId,
    uuid: `assistant-${apiId}`,
    message: {
      id: apiId,
      role: "assistant",
      content: [{ type: "text", text }],
    },
  };
}

function resultSuccess(sessionId: string, uuid = "result-1") {
  return {
    type: "result",
    subtype: "success",
    session_id: sessionId,
    uuid,
    result: "",
    is_error: false,
    usage: {},
    modelUsage: {},
  };
}

function messageChunkTexts(
  calls: ClientMocks["sessionUpdate"]["mock"]["calls"],
): string[] {
  return calls
    .map(
      ([call]) =>
        (
          call as {
            update?: { sessionUpdate?: string; content?: { text?: string } };
          }
        ).update,
    )
    .filter((update) => update?.sessionUpdate === "agent_message_chunk")
    .map((update) => update?.content?.text ?? "");
}

// Runs one complete turn: prompt -> echo -> assistant text -> result.
async function runTurn(
  agent: Agent,
  query: MockQuery,
  input: Pushable<SDKUserMessage>,
  sessionId: string,
  promptText: string,
  answerText: string,
  resultUuid: string,
): Promise<void> {
  const promptPromise = agent.prompt({
    sessionId,
    prompt: [{ type: "text", text: promptText }],
  });
  await tick();
  await echoUserMessage(query, input);
  await send(query, assistantMessage(sessionId, resultUuid, answerText));
  await send(query, resultSuccess(sessionId, resultUuid));
  const result = await promptPromise;
  expect(result.stopReason).toBe("end_turn");
}

describe("ClaudeAcpAgent — between-turns idle drain (autonomous /loop turns)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams an autonomous turn to the client with no second user prompt", async () => {
    const { agent, client } = makeAgent();
    const sessionId = "s-idle-1";
    const { query, input } = installFakeSession(agent, sessionId);

    await runTurn(
      agent,
      query,
      input,
      sessionId,
      "loop until CI passes",
      "checking CI now",
      "r1",
    );

    // Let the deferred startIdleDrain() run and block on query.next().
    await tick();

    // A fired ScheduleWakeup/loop turn appears with NO new prompt() call.
    await send(
      query,
      assistantMessage(sessionId, "r2", "still running, retrying"),
    );

    expect(messageChunkTexts(client.sessionUpdate.mock.calls)).toContain(
      "still running, retrying",
    );
  });

  it("hands the query back to a follow-up prompt without losing its echo", async () => {
    const { agent, client } = makeAgent();
    const sessionId = "s-idle-2";
    const { query, input } = installFakeSession(agent, sessionId);

    await runTurn(agent, query, input, sessionId, "loop", "first answer", "r1");
    await tick();

    // Autonomous turn streams in while idle.
    await send(query, assistantMessage(sessionId, "r2", "autonomous update"));
    await send(query, resultSuccess(sessionId, "r2"));

    // The user sends a follow-up. The drainer must release the query and hand
    // its echo to prompt() so the turn completes normally.
    await runTurn(
      agent,
      query,
      input,
      sessionId,
      "keep going",
      "second answer",
      "r3",
    );

    const texts = messageChunkTexts(client.sessionUpdate.mock.calls);
    expect(texts).toContain("autonomous update");
    expect(texts).toContain("second answer");
    // The autonomous message must appear exactly once (not re-emitted when the
    // follow-up prompt drained the backlog).
    expect(texts.filter((t) => t === "autonomous update")).toHaveLength(1);
  });
});
