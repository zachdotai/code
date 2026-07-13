import type { AgentConfig } from "./agents";
import { applyAgentOverrides, type SubagentSettings } from "./settings";

const COLUMNS = [
  { title: "Subagent", width: 24 },
  { title: "Model", width: 24 },
  { title: "Reasoning", width: 10 },
  { title: "Purpose", width: 72 },
] as const;

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  return `${value.slice(0, Math.max(0, width - 1))}…`;
}

function cell(value: string, width: number): string {
  return truncate(value, width).padEnd(width, " ");
}

function row(values: string[]): string {
  return values
    .map((value, index) => cell(value, COLUMNS[index].width))
    .join("  ");
}

export function formatSubagentRoster(
  agents: AgentConfig[],
  settings: SubagentSettings,
): string {
  if (agents.length === 0) return "No subagents available.";

  const separatorWidth =
    COLUMNS.reduce((total, column) => total + column.width, 0) +
    (COLUMNS.length - 1) * 2;
  const lines = [
    row(COLUMNS.map((column) => column.title)),
    "-".repeat(separatorWidth),
  ];
  for (const agent of agents) {
    const effective = applyAgentOverrides(agent, settings);
    lines.push(
      row([
        agent.source === "project" ? `${agent.name} (project)` : agent.name,
        effective.model ?? "inherit",
        effective.thinking ?? "default",
        effective.description,
      ]),
    );
  }
  return lines.join("\n");
}
