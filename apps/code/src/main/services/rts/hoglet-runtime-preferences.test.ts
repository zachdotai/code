import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/store", () => ({
  rendererStore: {
    has: vi.fn(() => false),
    get: vi.fn(),
  },
}));

vi.mock("../../utils/encryption", () => ({
  decrypt: vi.fn(),
}));

import { resolveHogletRuntime } from "./hoglet-runtime-preferences";
import {
  DEFAULT_CODEX_REASONING_EFFORT,
  defaultModelForAdapter,
} from "./schemas";

describe("resolveHogletRuntime", () => {
  it("uses user model preferences but keeps the autonomous permission default", () => {
    expect(
      resolveHogletRuntime(
        {},
        {
          runtimeAdapter: "codex",
          model: "gpt-5.5",
          reasoningEffort: "high",
        },
      ),
    ).toEqual({
      runtimeAdapter: "codex",
      model: "gpt-5.5",
      reasoningEffort: "high",
      executionMode: "full-access",
      environment: "cloud",
    });
  });

  it("lets explicit nest loadout override user preferences", () => {
    expect(
      resolveHogletRuntime(
        {
          runtimeAdapter: "claude",
          model: "claude-sonnet-4-5-20250929",
          reasoningEffort: "max",
          executionMode: "plan",
          environment: "local",
        },
        {
          runtimeAdapter: "codex",
          model: "gpt-5.5",
          reasoningEffort: "high",
        },
      ),
    ).toEqual({
      runtimeAdapter: "claude",
      model: "claude-sonnet-4-5-20250929",
      reasoningEffort: "max",
      executionMode: "plan",
      environment: "local",
    });
  });

  it("does not carry a preferred model across runtime adapters", () => {
    expect(
      resolveHogletRuntime(
        { runtimeAdapter: "codex" },
        {
          runtimeAdapter: "claude",
          model: "claude-sonnet-4-5-20250929",
          reasoningEffort: "max",
        },
      ),
    ).toEqual({
      runtimeAdapter: "codex",
      model: defaultModelForAdapter("codex"),
      reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
      executionMode: "full-access",
      environment: "cloud",
    });
  });

  it("defaults Claude hoglets to bypass permissions for autonomous cloud work", () => {
    expect(resolveHogletRuntime({}, {})).toEqual({
      runtimeAdapter: "claude",
      model: defaultModelForAdapter("claude"),
      reasoningEffort: "max",
      executionMode: "bypassPermissions",
      environment: "cloud",
    });
  });
});
