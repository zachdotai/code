import { describe, expect, it } from "vitest";
import {
  formatGatewayModelName,
  isBlockedModelId,
  supportsReasoningEffort,
} from "./gateway-models";

describe("formatGatewayModelName", () => {
  it("keeps Claude models in friendly title case", () => {
    expect(
      formatGatewayModelName({
        id: "claude-opus-4-8",
        owned_by: "anthropic",
        context_window: 200000,
        supports_streaming: true,
        supports_vision: true,
      }),
    ).toBe("Claude Opus 4.8");
  });

  it("formats OpenAI models as raw lowercase model ids", () => {
    expect(
      formatGatewayModelName({
        id: "openai/gpt-5.5",
        owned_by: "openai",
        context_window: 200000,
        supports_streaming: true,
        supports_vision: true,
      }),
    ).toBe("gpt-5.5");
  });
});

describe("isBlockedModelId", () => {
  it("blocks deprecated gateway models case-insensitively", () => {
    expect(isBlockedModelId("claude-haiku-4-5")).toBe(true);
    expect(isBlockedModelId("ANTHROPIC/CLAUDE-HAIKU-4-5")).toBe(true);
    expect(isBlockedModelId("gpt-5.3-codex")).toBe(true);
  });

  it("keeps current models", () => {
    expect(isBlockedModelId("claude-opus-4-8")).toBe(false);
    expect(isBlockedModelId("claude-sonnet-4-6")).toBe(false);
  });
});

describe("supportsReasoningEffort", () => {
  it("is true for models with an effort control", () => {
    expect(supportsReasoningEffort("claude-opus-4-8")).toBe(true);
    expect(supportsReasoningEffort("claude-sonnet-4-6")).toBe(true);
    expect(supportsReasoningEffort("claude-fable-5")).toBe(true);
  });

  it("is false for unknown models", () => {
    expect(supportsReasoningEffort("some-future-model")).toBe(false);
  });
});
