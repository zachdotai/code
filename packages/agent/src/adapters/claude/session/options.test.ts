import * as os from "node:os";
import * as path from "node:path";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { Logger } from "../../../utils/logger";
import { SUBAGENT_REWRITES } from "../hooks";
import { appendToSystemPrompt, buildSessionOptions } from "./options";
import { SettingsManager } from "./settings";

function makeParams() {
  const cwd = path.join(os.tmpdir(), `options-test-${Date.now()}`);
  return {
    cwd,
    mcpServers: {},
    permissionMode: "default" as const,
    canUseTool: async () => ({ behavior: "allow" as const, updatedInput: {} }),
    logger: new Logger(),
    sessionId: "test-session",
    isResume: false,
    settingsManager: new SettingsManager(cwd),
  };
}

describe("buildSessionOptions", () => {
  it.each(Object.entries(SUBAGENT_REWRITES))(
    'registers rewrite target "%s" → "%s" in options.agents',
    (_source, target) => {
      const options = buildSessionOptions(makeParams());
      const registered = new Set(Object.keys(options.agents ?? {}));

      expect(
        registered.has(target),
        `Rewrite target "${target}" is not registered in options.agents — either register the agent in buildAgents or remove the rewrite.`,
      ).toBe(true);
    },
  );

  it("preserves caller-provided agents alongside defaults", () => {
    const params = makeParams();
    const options = buildSessionOptions({
      ...params,
      userProvidedOptions: {
        agents: {
          "custom-agent": {
            description: "Custom",
            prompt: "Custom prompt",
          },
        },
      },
    });

    expect(options.agents?.["custom-agent"]).toBeDefined();
    expect(options.agents?.["ph-explore"]).toBeDefined();
  });

  it("lets caller-provided agents override defaults by name", () => {
    const params = makeParams();
    const override = {
      description: "Overridden",
      prompt: "Overridden prompt",
    };
    const options = buildSessionOptions({
      ...params,
      userProvidedOptions: {
        agents: {
          "ph-explore": override,
        },
      },
    });

    expect(options.agents?.["ph-explore"]).toEqual(override);
  });

  describe("add-on contribution wiring", () => {
    it("places add-on PreToolUse hooks BEFORE the built-in permission gate", () => {
      // Ordering invariant called out in options.ts: a rewrite from rtk/etc.
      // must run before createPreToolUseHook so the permission check sees the
      // rewritten command, not the raw one.
      const addOnHook: HookCallback = vi.fn();
      const options = buildSessionOptions({
        ...makeParams(),
        addOnContribution: { preToolUse: [addOnHook] },
      });

      const preToolUse = options.hooks?.PreToolUse;
      expect(preToolUse).toBeDefined();
      // First group is the add-on group, second group is the built-ins.
      expect(preToolUse?.[0].hooks).toContain(addOnHook);
      expect(preToolUse?.[1].hooks?.length ?? 0).toBeGreaterThan(0);
      expect(preToolUse?.[1].hooks).not.toContain(addOnHook);
    });

    it("places add-on PostToolUse hooks AFTER the built-in post-tool group", () => {
      const addOnHook: HookCallback = vi.fn();
      const options = buildSessionOptions({
        ...makeParams(),
        addOnContribution: { postToolUse: [addOnHook] },
      });

      const postToolUse = options.hooks?.PostToolUse;
      expect(postToolUse).toBeDefined();
      // Built-in group first, then add-on group last.
      const lastGroup = postToolUse?.[postToolUse.length - 1];
      expect(lastGroup?.hooks).toContain(addOnHook);
    });

    it("omits the add-on PreToolUse group entirely when contribution is empty", () => {
      // Regression guard: an empty hooks array should not insert a phantom
      // group ahead of the built-in permission gate.
      const options = buildSessionOptions({
        ...makeParams(),
        addOnContribution: { preToolUse: [] },
      });

      const preToolUse = options.hooks?.PreToolUse;
      // Only the built-in group should be present.
      expect(preToolUse?.length).toBe(1);
    });

    it("appends systemPromptAppend to the default preset's append field", () => {
      const options = buildSessionOptions({
        ...makeParams(),
        addOnContribution: { systemPromptAppend: "[FROM_ADDON]" },
      });

      const prompt = options.systemPrompt;
      expect(prompt).toMatchObject({ type: "preset", preset: "claude_code" });
      // The default APPENDED_INSTRUCTIONS sits before the add-on text.
      const append = (prompt as { append?: string }).append ?? "";
      expect(append.endsWith("[FROM_ADDON]")).toBe(true);
    });

    it("concatenates systemPromptAppend onto a string systemPrompt", () => {
      const options = buildSessionOptions({
        ...makeParams(),
        systemPrompt: "BASE_PROMPT",
        addOnContribution: { systemPromptAppend: "_FROM_ADDON" },
      });

      expect(options.systemPrompt).toBe("BASE_PROMPT_FROM_ADDON");
    });

    it("merges add-on env vars and lets them win over the defaults", () => {
      const options = buildSessionOptions({
        ...makeParams(),
        addOnContribution: {
          env: {
            // Override one default to prove last-write-wins
            ENABLE_TOOL_SEARCH: "off",
            // And add a brand-new key
            ADDON_INJECTED: "yes",
          },
        },
      });

      expect(options.env?.ENABLE_TOOL_SEARCH).toBe("off");
      expect(options.env?.ADDON_INJECTED).toBe("yes");
      // Defaults that the add-on did not touch still come through.
      expect(options.env?.ELECTRON_RUN_AS_NODE).toBe("1");
    });

    it("does not break when addOnContribution is omitted entirely", () => {
      // Regression guard: the optional contribution must not be required.
      const options = buildSessionOptions(makeParams());

      expect(options.hooks?.PreToolUse?.length).toBe(1);
      expect(options.systemPrompt).toMatchObject({ type: "preset" });
    });
  });
});

describe("appendToSystemPrompt", () => {
  it("returns the input unchanged when there is nothing to append", () => {
    expect(appendToSystemPrompt("hello", undefined)).toBe("hello");
    const preset = { type: "preset" as const, preset: "claude_code" as const };
    expect(appendToSystemPrompt(preset, undefined)).toBe(preset);
  });

  it("concatenates onto a string systemPrompt", () => {
    expect(appendToSystemPrompt("base", "_extra")).toBe("base_extra");
  });

  it("appends to the `append` field of a preset object", () => {
    const result = appendToSystemPrompt(
      { type: "preset", preset: "claude_code", append: "existing-" },
      "added",
    );
    expect(result).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "existing-added",
    });
  });

  it("treats a preset without an `append` field as if it were empty", () => {
    const result = appendToSystemPrompt(
      { type: "preset", preset: "claude_code" },
      "first-time",
    ) as { append?: string };
    expect(result.append).toBe("first-time");
  });
});
