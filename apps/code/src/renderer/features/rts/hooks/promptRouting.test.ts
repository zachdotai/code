import type { InjectPromptEventPayload } from "@main/services/rts/schemas";
import { describe, expect, it } from "vitest";
import { resolveHedgemonyPromptRoute } from "./promptRouting";

function makePayload(
  overrides: Partial<InjectPromptEventPayload> = {},
): InjectPromptEventPayload {
  return {
    taskId: "task-1",
    hogletId: "hoglet-1",
    nestId: "nest-1",
    source: "hedgehog",
    targetRunStatus: "in_progress",
    payloadRef: "hedgehog-message:nest-1:tool-1",
    payloadHash: "hash",
    prompt: "Status?",
    prUrl: "",
    fallbackPrompt: "Status?",
    ...overrides,
  };
}

describe("resolveHedgemonyPromptRoute", () => {
  it("injects external feedback when the session is connected", () => {
    expect(
      resolveHedgemonyPromptRoute({
        payload: makePayload({
          source: "pr_review",
          prUrl: "https://github.com/org/repo/pull/1",
        }),
        sessionStatus: "connected",
      }),
    ).toBe("inject");
  });

  it("spawns follow-ups for hedgehog fallback events even with stale connected session state", () => {
    expect(
      resolveHedgemonyPromptRoute({
        payload: makePayload({ targetRunStatus: "in_progress" }),
        sessionStatus: "connected",
      }),
    ).toBe("spawn_follow_up");
  });

  it("fails detached events without a nest", () => {
    expect(
      resolveHedgemonyPromptRoute({
        payload: makePayload({ nestId: null }),
        sessionStatus: "disconnected",
      }),
    ).toBe("failed");
  });

  it("still spawns follow-ups for external feedback", () => {
    expect(
      resolveHedgemonyPromptRoute({
        payload: makePayload({
          source: "pr_review",
          targetRunStatus: "in_progress",
          prUrl: "https://github.com/org/repo/pull/1",
        }),
        sessionStatus: "disconnected",
      }),
    ).toBe("spawn_follow_up");
  });
});
