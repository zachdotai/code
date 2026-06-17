import { describe, expect, it } from "vitest";
import { isSupportedReasoningEffort } from "./reasoning-effort";

describe("isSupportedReasoningEffort", () => {
  it("rejects xhigh for codex models, including the gpt-5.5 family", () => {
    expect(isSupportedReasoningEffort("codex", "gpt-5.5", "xhigh")).toBe(false);
    expect(isSupportedReasoningEffort("codex", "gpt-5.5-codex", "xhigh")).toBe(
      false,
    );
    expect(isSupportedReasoningEffort("codex", "gpt-5.3-codex", "xhigh")).toBe(
      false,
    );
  });

  it("rejects unknown effort values", () => {
    expect(isSupportedReasoningEffort("codex", "gpt-5.5", "ultra")).toBe(false);
  });

  it("gates xhigh on Claude models by id", () => {
    expect(
      isSupportedReasoningEffort("claude", "claude-opus-4-8", "xhigh"),
    ).toBe(true);
    expect(
      isSupportedReasoningEffort("claude", "claude-sonnet-4-6", "xhigh"),
    ).toBe(false);
  });
});
