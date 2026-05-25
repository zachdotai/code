import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  HookCallback,
  HookInput,
  HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { Logger } from "../utils/logger";
import { AddOnRegistry } from "./registry";
import { rtkAddOn } from "./rtk";
import type { AddOnContext, AddOnContribution } from "./types";

function firstHook(contribution: AddOnContribution): HookCallback {
  const hook = contribution.preToolUse?.[0];
  if (!hook) {
    throw new Error("expected a PreToolUse hook on contribution");
  }
  return hook;
}

function makeFakeRtkBinary(): string {
  const dir = mkdtempSync(join(tmpdir(), "rtk-test-"));
  const binaryPath = join(dir, "rtk");
  writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return binaryPath;
}

function makeCtx(overrides: Partial<AddOnContext> = {}): AddOnContext {
  return {
    cwd: "/tmp/fake",
    adapter: "claude",
    logger: new Logger(),
    ...overrides,
  };
}

async function runHook(
  hook: HookCallback,
  partial: { tool_name: string; tool_input?: Record<string, unknown> },
): Promise<HookJSONOutput> {
  const input = {
    hook_event_name: "PreToolUse",
    session_id: "s",
    transcript_path: "/tmp/t",
    cwd: "/tmp",
    tool_name: partial.tool_name,
    tool_input: partial.tool_input ?? {},
  } as HookInput;
  return hook(input, "tool-use-id", { signal: new AbortController().signal });
}

describe("rtk add-on", () => {
  let binaryPath: string;

  beforeEach(() => {
    binaryPath = makeFakeRtkBinary();
  });

  it("rejects unknown options keys", () => {
    expect(() => rtkAddOn.parseOptions({ binaryPath: 42 })).toThrow();
  });

  it("throws from contribute() when the configured binary is missing", () => {
    expect(() =>
      rtkAddOn.contribute(
        makeCtx(),
        rtkAddOn.parseOptions({ binaryPath: "/does/not/exist/rtk" }),
      ),
    ).toThrow(/binary not found/);
  });

  it("contributes a PreToolUse hook that rewrites Bash commands", async () => {
    const contribution = await rtkAddOn.contribute(
      makeCtx(),
      rtkAddOn.parseOptions({ binaryPath }),
    );
    expect(contribution.preToolUse).toHaveLength(1);

    const hook = firstHook(contribution);
    const result = (await runHook(hook, {
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
    })) as {
      hookSpecificOutput?: {
        hookEventName: string;
        updatedInput: { command: string };
      };
    };

    expect(result.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
    expect(result.hookSpecificOutput?.updatedInput.command).toBe(
      `'${binaryPath}' run -- ls -la`,
    );
  });

  it("passes through non-Bash tool calls unchanged", async () => {
    const contribution = await rtkAddOn.contribute(
      makeCtx(),
      rtkAddOn.parseOptions({ binaryPath }),
    );
    const hook = firstHook(contribution);
    const result = (await runHook(hook, {
      tool_name: "Read",
      tool_input: { file_path: "/etc/hosts" },
    })) as { continue: boolean; hookSpecificOutput?: unknown };

    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it("appends --skip-permissions when configured", async () => {
    const contribution = await rtkAddOn.contribute(
      makeCtx(),
      rtkAddOn.parseOptions({ binaryPath, skipPermissions: true }),
    );
    const hook = firstHook(contribution);
    const result = (await runHook(hook, {
      tool_name: "Bash",
      tool_input: { command: "echo hi" },
    })) as {
      hookSpecificOutput?: { updatedInput: { command: string } };
    };
    expect(result.hookSpecificOutput?.updatedInput.command).toBe(
      `'${binaryPath}' run --skip-permissions -- echo hi`,
    );
  });

  it("declares itself unsupported on Codex so the registry skips it", async () => {
    const registry = new AddOnRegistry();
    registry.register(rtkAddOn);

    const result = await registry.collect(
      { rtk: { binaryPath } },
      makeCtx({ adapter: "codex" }),
    );
    expect(result.preToolUse).toBeUndefined();
  });

  it("end-to-end: resolves through the registry on Claude", async () => {
    const registry = new AddOnRegistry();
    registry.register(rtkAddOn);

    const result = await registry.collect(
      { rtk: { binaryPath } },
      makeCtx({ adapter: "claude" }),
    );
    expect(result.preToolUse).toHaveLength(1);
  });

  it("does not double-wrap an already-wrapped command", async () => {
    const contribution = await rtkAddOn.contribute(
      makeCtx(),
      rtkAddOn.parseOptions({ binaryPath }),
    );
    const hook = firstHook(contribution);
    const wrapped = `'${binaryPath}' run -- echo hi`;
    const result = (await runHook(hook, {
      tool_name: "Bash",
      tool_input: { command: wrapped },
    })) as { continue: boolean; hookSpecificOutput?: unknown };

    expect(result.hookSpecificOutput).toBeUndefined();
    expect(result.continue).toBe(true);
  });

  it("escapes single quotes inside the binary path", async () => {
    // Make a binary at a path that already contains a quote — verifies escaping.
    const dir = mkdtempSync(join(tmpdir(), "rtk-quote-"));
    const quoted = join(dir, "weird'name");
    mkdirSync(quoted, { recursive: true });
    const bp = join(quoted, "rtk");
    writeFileSync(bp, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const contribution = await rtkAddOn.contribute(
      makeCtx(),
      rtkAddOn.parseOptions({ binaryPath: bp }),
    );
    const hook = firstHook(contribution);
    const result = (await runHook(hook, {
      tool_name: "Bash",
      tool_input: { command: "ls" },
    })) as {
      hookSpecificOutput?: { updatedInput: { command: string } };
    };
    expect(result.hookSpecificOutput?.updatedInput.command).toContain("'\\''");
  });
});
