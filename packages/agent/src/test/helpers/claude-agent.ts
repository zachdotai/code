import type {
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { vi } from "vitest";
import { Pushable } from "../../utils/streams";
import { createMockQuery, type MockQuery } from "../mocks/claude-sdk";

/**
 * Shared test harness for `ClaudeAcpAgent` unit tests. `makeAgent` stays in each
 * test file because it news up the dynamically-imported (post-`vi.mock`) agent
 * class; everything here is class-independent so it carries no mock-timing risk.
 */

export interface ClientMocks {
  sessionUpdate: ReturnType<typeof vi.fn>;
  extNotification: ReturnType<typeof vi.fn>;
}

export function makeClientMocks(): ClientMocks {
  return {
    sessionUpdate: vi.fn().mockResolvedValue(undefined),
    extNotification: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Install a fake in-memory session on an agent and return its query + input
 * stream. Pass `knownSlashCommands` for slash-command tests; other fields are
 * inert for tests that don't use them.
 */
export function installFakeSession(
  agent: object,
  sessionId: string,
  knownSlashCommands?: Set<string>,
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
    knownSlashCommands,
  };

  (agent as unknown as { session: typeof session }).session = session;
  (agent as unknown as { sessionId: string }).sessionId = sessionId;

  return { query, input };
}

export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export async function send(query: MockQuery, message: unknown): Promise<void> {
  query._mockHelpers.sendMessage(message as SDKMessage);
  await tick();
}

/**
 * Replay the prompt's own user message back through the query so
 * `promptReplayed` flips and the terminal `result` is not skipped.
 */
export async function echoUserMessage(
  query: MockQuery,
  input: Pushable<SDKUserMessage>,
): Promise<void> {
  const { value: pushed } = await input[Symbol.asyncIterator]().next();
  await send(query, pushed);
}

export function assistantMessage(
  sessionId: string,
  apiId: string,
  text: string,
) {
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

export function resultSuccess(sessionId: string, uuid = "result-1") {
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

export function messageChunkTexts(
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
