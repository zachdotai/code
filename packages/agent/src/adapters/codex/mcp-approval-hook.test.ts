import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexMcpApprovalHookBridge } from "./mcp-approval-hook";

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe("CodexMcpApprovalHookBridge", () => {
  let bridge: CodexMcpApprovalHookBridge | undefined;

  afterEach(async () => {
    await bridge?.stop();
    bridge = undefined;
  });

  it("forwards PreToolUse hook input to the approval handler", async () => {
    const preToolUse = vi.fn().mockResolvedValue({
      action: "deny" as const,
      message: "blocked",
    });
    bridge = new CodexMcpApprovalHookBridge(
      {
        preToolUse,
        postToolUse: vi.fn(),
      },
      noopLogger,
    );
    const env = await bridge.start();

    const response = await fetch(`${env.bridgeUrl}/pre-tool-use`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.bridgeToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "mcp__Granola__query_granola_meetings",
        tool_use_id: "tool-1",
        tool_input: { limit: 10 },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      action: "deny",
      message: "blocked",
    });
    expect(preToolUse).toHaveBeenCalledWith(
      expect.objectContaining({
        hookEventName: "PreToolUse",
        toolName: "mcp__Granola__query_granola_meetings",
        toolUseId: "tool-1",
        toolInput: { limit: 10 },
      }),
    );
  });

  it("forwards PostToolUse hook input to the cleanup handler", async () => {
    const postToolUse = vi.fn().mockResolvedValue(undefined);
    bridge = new CodexMcpApprovalHookBridge(
      {
        preToolUse: vi.fn(),
        postToolUse,
      },
      noopLogger,
    );
    const env = await bridge.start();

    const response = await fetch(`${env.bridgeUrl}/post-tool-use`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.bridgeToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "mcp__Granola__query_granola_meetings",
        tool_use_id: "tool-1",
        tool_response: { ok: true },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ action: "allow" });
    expect(postToolUse).toHaveBeenCalledWith(
      expect.objectContaining({
        hookEventName: "PostToolUse",
        toolName: "mcp__Granola__query_granola_meetings",
        toolUseId: "tool-1",
        toolResponse: { ok: true },
      }),
    );
  });

  it("rejects requests without the bridge token", async () => {
    bridge = new CodexMcpApprovalHookBridge(
      {
        preToolUse: vi.fn(),
        postToolUse: vi.fn(),
      },
      noopLogger,
    );
    const env = await bridge.start();

    const response = await fetch(`${env.bridgeUrl}/pre-tool-use`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "mcp__Granola__query_granola_meetings",
      }),
    });

    expect(response.status).toBe(401);
  });
});
