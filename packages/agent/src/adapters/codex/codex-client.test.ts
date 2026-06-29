import type {
  AgentSideConnection,
  ReadTextFileRequest,
  ReadTextFileResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import { describe, expect, test, vi } from "vitest";
import type { FileEnrichmentDeps } from "../../enrichment/file-enricher";
import { Logger } from "../../utils/logger";

const enrichFileMock = vi.hoisted(() => vi.fn());
vi.mock("../../enrichment/file-enricher", () => ({
  enrichFileForAgent: enrichFileMock,
}));

import { createCodexClient } from "./codex-client";
import { createSessionState, resetSessionState } from "./session-state";

function makeUpstream(response: ReadTextFileResponse): AgentSideConnection & {
  readTextFile: ReturnType<typeof vi.fn>;
} {
  const mock = {
    readTextFile: vi.fn(async (_: ReadTextFileRequest) => response),
    writeTextFile: vi.fn(),
    requestPermission: vi.fn(),
    sessionUpdate: vi.fn(),
    createTerminal: vi.fn(),
    terminalOutput: vi.fn(),
    releaseTerminal: vi.fn(),
    waitForTerminalExit: vi.fn(),
    killTerminal: vi.fn(),
    extMethod: vi.fn(),
    extNotification: vi.fn(),
  };
  return mock as unknown as AgentSideConnection & {
    readTextFile: ReturnType<typeof vi.fn>;
  };
}

describe("createCodexClient readTextFile", () => {
  const logger = new Logger({ debug: false, prefix: "[test]" });
  const sessionState = createSessionState("", "/tmp");

  test("returns upstream response unchanged when enrichmentDeps is absent", async () => {
    enrichFileMock.mockReset();
    const upstream = makeUpstream({ content: "const x = 1;" });
    const client = createCodexClient(upstream, logger, sessionState);

    const result = await client.readTextFile?.({
      sessionId: "s",
      path: "/tmp/a.ts",
    });
    expect(result?.content).toBe("const x = 1;");
    expect(enrichFileMock).not.toHaveBeenCalled();
  });

  test("returns enriched content when helper returns a string", async () => {
    enrichFileMock.mockReset();
    enrichFileMock.mockResolvedValueOnce("const x = 1; // [PostHog] Flag ...");

    const upstream = makeUpstream({ content: "const x = 1;" });
    const deps = {} as FileEnrichmentDeps;
    const client = createCodexClient(upstream, logger, sessionState, {
      enrichmentDeps: deps,
    });

    const result = await client.readTextFile?.({
      sessionId: "s",
      path: "/tmp/a.ts",
    });
    expect(result?.content).toBe("const x = 1; // [PostHog] Flag ...");
    expect(enrichFileMock).toHaveBeenCalledWith(
      deps,
      "/tmp/a.ts",
      "const x = 1;",
    );
  });

  test("falls back to upstream response when helper returns null", async () => {
    enrichFileMock.mockReset();
    enrichFileMock.mockResolvedValueOnce(null);

    const upstream = makeUpstream({ content: "no posthog here" });
    const client = createCodexClient(upstream, logger, sessionState, {
      enrichmentDeps: {} as FileEnrichmentDeps,
    });

    const result = await client.readTextFile?.({
      sessionId: "s",
      path: "/tmp/a.ts",
    });
    expect(result?.content).toBe("no posthog here");
  });

  test("calls upstream.readTextFile with original params (UI sees original)", async () => {
    enrichFileMock.mockReset();
    enrichFileMock.mockResolvedValueOnce("enriched");

    const upstream = makeUpstream({ content: "original" });
    const client = createCodexClient(upstream, logger, sessionState, {
      enrichmentDeps: {} as FileEnrichmentDeps,
    });

    const params = {
      sessionId: "s",
      path: "/tmp/a.ts",
      line: 10,
      limit: 5,
    };
    await client.readTextFile?.(params);
    expect(upstream.readTextFile).toHaveBeenCalledWith(params);
  });
});

describe("createCodexClient MCP Store permissions", () => {
  const logger = new Logger({ debug: false, prefix: "[test]" });
  const ALLOW_OPTIONS = [
    { kind: "allow_once" as const, optionId: "allow", name: "Allow" },
    { kind: "reject_once" as const, optionId: "reject", name: "Reject" },
  ];

  function makePermissionUpstream(
    response = {
      outcome: { outcome: "selected" as const, optionId: "allow" },
    },
  ): AgentSideConnection & { requestPermission: ReturnType<typeof vi.fn> } {
    return {
      sessionUpdate: vi.fn(async () => {}),
      requestPermission: vi.fn(async () => response),
      readTextFile: vi.fn(),
      writeTextFile: vi.fn(),
      createTerminal: vi.fn(),
      terminalOutput: vi.fn(),
      releaseTerminal: vi.fn(),
      waitForTerminalExit: vi.fn(),
      killTerminal: vi.fn(),
      extMethod: vi.fn(),
      extNotification: vi.fn(),
    } as unknown as AgentSideConnection & {
      requestPermission: ReturnType<typeof vi.fn>;
    };
  }

  test("relays needs_approval MCP tools by bare title even in full-access mode without promoting allow once", async () => {
    const toolName = "mcp__Granola__query_granola_meetings";
    const upstream = makePermissionUpstream();
    const sessionState = createSessionState("sess", "/tmp", {
      permissionMode: "full-access",
      mcpToolApprovals: { [toolName]: "needs_approval" },
      mcpToolInstallations: {
        [toolName]: {
          installationId: "inst-1",
          toolName: "query_granola_meetings",
        },
      },
    });
    const client = createCodexClient(upstream, logger, sessionState);

    const result = await client.requestPermission?.({
      options: ALLOW_OPTIONS,
      toolCall: {
        toolCallId: "tc-1",
        title: "query_granola_meetings",
        kind: "other",
        rawInput: { search: "today" },
      },
    } as never);

    expect(result?.outcome.outcome).toBe("selected");
    expect(upstream.requestPermission).toHaveBeenCalledTimes(1);
    expect(upstream.requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCall: expect.objectContaining({
          rawInput: expect.objectContaining({
            search: "today",
            toolName,
          }),
        }),
      }),
    );
    expect(sessionState.mcpToolApprovals?.[toolName]).toBe("needs_approval");
  });

  test("promotes needs_approval MCP tools only when the user chooses always allow", async () => {
    const toolName = "mcp__Granola_Meetings__query_granola_meetings";
    const upstream = makePermissionUpstream({
      outcome: { outcome: "selected" as const, optionId: "allow_always" },
    });
    const sessionState = createSessionState("sess", "/tmp", {
      permissionMode: "full-access",
      mcpToolApprovals: { [toolName]: "needs_approval" },
      mcpToolInstallations: {
        [toolName]: {
          installationId: "inst-1",
          toolName: "query_granola_meetings",
        },
      },
    });
    const client = createCodexClient(upstream, logger, sessionState);

    await client.requestPermission?.({
      options: ALLOW_OPTIONS,
      toolCall: {
        toolCallId: "tc-1",
        title: "mcp__Granola Meetings__query_granola_meetings",
        kind: "other",
      },
    } as never);

    expect(upstream.requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCall: expect.objectContaining({
          rawInput: expect.objectContaining({ toolName }),
        }),
      }),
    );
    expect(sessionState.mcpToolApprovals?.[toolName]).toBe("approved");
  });

  test("cancels blocked MCP tools before they reach the upstream permission flow", async () => {
    const toolName = "mcp__Granola__query_granola_meetings";
    const upstream = makePermissionUpstream();
    const sessionState = createSessionState("sess", "/tmp", {
      permissionMode: "full-access",
      mcpToolApprovals: { [toolName]: "do_not_use" },
      mcpToolInstallations: {
        [toolName]: {
          installationId: "inst-1",
          toolName: "query_granola_meetings",
        },
      },
    });
    const client = createCodexClient(upstream, logger, sessionState);

    const result = await client.requestPermission?.({
      options: ALLOW_OPTIONS,
      toolCall: {
        toolCallId: "tc-1",
        title: "query_granola_meetings",
        kind: "other",
      },
    } as never);

    expect(result?.outcome.outcome).toBe("cancelled");
    expect(upstream.requestPermission).not.toHaveBeenCalled();
  });
});

describe("createCodexClient onStructuredOutput", () => {
  const logger = new Logger({ debug: false, prefix: "[test]" });
  const sessionState = createSessionState("sess", "/tmp");

  function makeUpstream(): AgentSideConnection {
    return {
      sessionUpdate: vi.fn(async () => {}),
      requestPermission: vi.fn(),
      readTextFile: vi.fn(),
      writeTextFile: vi.fn(),
      createTerminal: vi.fn(),
      terminalOutput: vi.fn(),
      releaseTerminal: vi.fn(),
      waitForTerminalExit: vi.fn(),
      killTerminal: vi.fn(),
      extMethod: vi.fn(),
      extNotification: vi.fn(),
    } as unknown as AgentSideConnection;
  }

  function notification(update: Record<string, unknown>): SessionNotification {
    return {
      sessionId: "sess",
      update,
    } as unknown as SessionNotification;
  }

  test("fires once when create_output completes after rawInput arrived", async () => {
    const onStructuredOutput = vi.fn(async () => {});
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState, {
      onStructuredOutput,
    });

    await client.sessionUpdate?.(
      notification({
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "create_output",
        status: "in_progress",
        rawInput: { result: "ok", count: 5 },
      }),
    );
    expect(onStructuredOutput).not.toHaveBeenCalled();

    await client.sessionUpdate?.(
      notification({
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        title: "create_output",
        status: "completed",
      }),
    );

    expect(onStructuredOutput).toHaveBeenCalledTimes(1);
    expect(onStructuredOutput).toHaveBeenCalledWith({ result: "ok", count: 5 });
  });

  test("matches mcp__-prefixed tool titles", async () => {
    const onStructuredOutput = vi.fn(async () => {});
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState, {
      onStructuredOutput,
    });

    await client.sessionUpdate?.(
      notification({
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "mcp__posthog_output__create_output",
        status: "completed",
        rawInput: { ok: true },
      }),
    );

    expect(onStructuredOutput).toHaveBeenCalledWith({ ok: true });
  });

  test("ignores tool calls that aren't create_output", async () => {
    const onStructuredOutput = vi.fn(async () => {});
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState, {
      onStructuredOutput,
    });

    await client.sessionUpdate?.(
      notification({
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "Read",
        status: "completed",
        rawInput: { path: "/tmp/x" },
      }),
    );

    expect(onStructuredOutput).not.toHaveBeenCalled();
  });

  test("does not fire when rawInput never arrived", async () => {
    const onStructuredOutput = vi.fn(async () => {});
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState, {
      onStructuredOutput,
    });

    await client.sessionUpdate?.(
      notification({
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "create_output",
        status: "completed",
      }),
    );

    expect(onStructuredOutput).not.toHaveBeenCalled();
  });

  test("does not fire twice if completed is re-emitted for the same tool call", async () => {
    const onStructuredOutput = vi.fn(async () => {});
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState, {
      onStructuredOutput,
    });

    const completed = notification({
      sessionUpdate: "tool_call",
      toolCallId: "tc-1",
      title: "create_output",
      status: "completed",
      rawInput: { final: 1 },
    });

    await client.sessionUpdate?.(completed);
    await client.sessionUpdate?.(completed);

    expect(onStructuredOutput).toHaveBeenCalledTimes(1);
  });

  test("forwards the notification upstream regardless of structured-output handling", async () => {
    const onStructuredOutput = vi.fn(async () => {});
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState, {
      onStructuredOutput,
    });

    const note = notification({
      sessionUpdate: "tool_call",
      toolCallId: "tc-1",
      title: "create_output",
      status: "completed",
      rawInput: { final: 1 },
    });
    await client.sessionUpdate?.(note);

    expect(upstream.sessionUpdate).toHaveBeenCalledWith(note);
  });

  test("does nothing when the callback is not wired", async () => {
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState);

    // No onStructuredOutput configured — must not throw and must still
    // forward upstream.
    await client.sessionUpdate?.(
      notification({
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "create_output",
        status: "completed",
        rawInput: { x: 1 },
      }),
    );

    expect(upstream.sessionUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("createCodexClient usage_update propagation", () => {
  const logger = new Logger({ debug: false, prefix: "[test]" });

  function makeUpstream(): AgentSideConnection {
    return {
      sessionUpdate: vi.fn(async () => {}),
      requestPermission: vi.fn(),
      readTextFile: vi.fn(),
      writeTextFile: vi.fn(),
      createTerminal: vi.fn(),
      terminalOutput: vi.fn(),
      releaseTerminal: vi.fn(),
      waitForTerminalExit: vi.fn(),
      killTerminal: vi.fn(),
      extMethod: vi.fn(),
      extNotification: vi.fn(),
    } as unknown as AgentSideConnection;
  }

  // Regression: codex-client closure-captures the sessionState reference in
  // its factory. CodexAcpAgent constructs the client once at startup with the
  // initial "" sessionId state, then resetSessionState() mutates that same
  // object on every newSession/loadSession/etc. If the agent ever reassigned
  // `this.sessionState`, contextUsed writes would land on an orphan and the
  // breakdown notification would never fire.
  test("writes contextUsed to the same state object after resetSessionState", async () => {
    const sessionState = createSessionState("", "/tmp");
    const upstream = makeUpstream();
    const client = createCodexClient(upstream, logger, sessionState);

    resetSessionState(sessionState, "real-session", "/tmp/repo", {
      taskRunId: "run-1",
    });

    await client.sessionUpdate?.({
      sessionId: "real-session",
      update: {
        sessionUpdate: "usage_update",
        used: 123_456,
        size: 200_000,
      },
    } as unknown as SessionNotification);

    expect(sessionState.contextUsed).toBe(123_456);
    expect(sessionState.contextSize).toBe(200_000);
  });
});
