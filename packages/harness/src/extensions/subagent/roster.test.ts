import { describe, expect, it } from "vitest";
import type { AgentConfig } from "./agents";
import { formatSubagentRoster } from "./roster";

const agent: AgentConfig = {
  name: "code-reviewer",
  description: "Review diffs for correctness and quality",
  model: "gpt-5.6-sol",
  systemPrompt: "",
  source: "bundled",
};

describe("formatSubagentRoster", () => {
  it("renders the effective model and reasoning settings", () => {
    const roster = formatSubagentRoster([agent], {
      agentOverrides: { "code-reviewer": { thinking: "low" } },
    });

    expect(roster).toContain("Subagent");
    expect(roster).toContain("code-reviewer");
    expect(roster).toContain("gpt-5.6-sol");
    expect(roster).toContain("low");
    expect(roster).toContain("Review diffs for correctness and quality");
  });

  it("marks project agents and truncates long purposes", () => {
    const roster = formatSubagentRoster(
      [
        {
          ...agent,
          source: "project",
          description: "a".repeat(100),
        },
      ],
      {},
    );

    expect(roster).toContain("code-reviewer (project)");
    expect(roster).toContain("a".repeat(71));
    expect(roster).toContain("…");
  });
});
