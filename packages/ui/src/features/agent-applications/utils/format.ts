import type {
  AgentRevisionState,
  AgentSessionState,
} from "@posthog/shared/agent-platform-types";

/** Formats a USD spend value for the fleet / agent stat strips. */
export function formatSpendUsd(value: number | null | undefined): string {
  if (value == null) return "$0";
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Radix Badge colour for a session lifecycle state. */
export function sessionStateColor(
  state: AgentSessionState,
): "green" | "blue" | "gray" | "red" | "amber" {
  switch (state) {
    case "running":
      return "blue";
    case "queued":
      return "amber";
    case "completed":
    case "closed":
      return "green";
    case "failed":
      return "red";
    case "cancelled":
      return "gray";
    default:
      return "gray";
  }
}

/** Radix Badge colour for a revision lifecycle state. */
export function revisionStateColor(
  state: AgentRevisionState,
): "green" | "blue" | "gray" | "amber" {
  switch (state) {
    case "live":
      return "green";
    case "ready":
      return "blue";
    case "draft":
      return "amber";
    default:
      return "gray";
  }
}
