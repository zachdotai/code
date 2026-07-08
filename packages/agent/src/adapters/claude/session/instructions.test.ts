import { describe, expect, it } from "vitest";
import { APPENDED_INSTRUCTIONS } from "./instructions";

describe("APPENDED_INSTRUCTIONS", () => {
  it("directs the agent to use the PostHog Code PR footer, not the Claude Code default", () => {
    // The SDK's claude_code preset defaults PR descriptions to a
    // "🤖 Generated with Claude Code" footer. Our appended instructions must
    // suppress that default and substitute the PostHog Code footer so PRs are
    // attributed correctly in both desktop and cloud sessions.
    expect(APPENDED_INSTRUCTIONS).toContain("Generated with Claude Code");
    // ...but only to forbid it, never to instruct its use.
    expect(APPENDED_INSTRUCTIONS).toMatch(
      /do NOT use the default Claude Code PR footer.*Generated with Claude Code/s,
    );

    expect(APPENDED_INSTRUCTIONS).toContain(
      "*Created with [PostHog Code](https://posthog.com/code?ref=pr)*",
    );
  });

  it("places a horizontal rule before the PostHog Code footer", () => {
    expect(APPENDED_INSTRUCTIONS).toMatch(
      /---\s*\n\*Created with \[PostHog Code\]\(https:\/\/posthog\.com\/code\?ref=pr\)\*/,
    );
  });
});
