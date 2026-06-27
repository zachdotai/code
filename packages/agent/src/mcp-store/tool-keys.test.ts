import { describe, expect, it } from "vitest";
import { resolveMcpStoreToolKey, sanitizeMcpServerName } from "./tool-keys";

describe("MCP Store tool keys", () => {
  it("sanitizes server names without regular expressions", () => {
    expect(sanitizeMcpServerName("Granola Meetings")).toBe("Granola_Meetings");
    expect(sanitizeMcpServerName("server@v2.0!")).toBe("server_v2_0_");
  });

  it("matches server identities after collapsing and trimming underscores", () => {
    expect(
      resolveMcpStoreToolKey("mcp__Granola   Meetings__query", {
        approvals: { mcp__Granola_Meetings__query: "needs_approval" },
      }),
    ).toBe("mcp__Granola_Meetings__query");
  });

  it("parses approval dialog titles without regex backtracking", () => {
    expect(
      resolveMcpStoreToolKey(
        "The agent wants to call query_granola_meetings (Granola Meetings)",
        {
          approvals: {
            mcp__Granola_Meetings__query_granola_meetings: "needs_approval",
          },
        },
      ),
    ).toBe("mcp__Granola_Meetings__query_granola_meetings");
  });
});
