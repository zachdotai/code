import type { SignalReport } from "@posthog/shared/domain-types";

export function isReportAwaitingInput(report: SignalReport): boolean {
  return (
    report.status === "pending_input" ||
    (report.status === "ready" &&
      report.actionability === "requires_human_input")
  );
}

export function canCreateImplementationPr(report: SignalReport): boolean {
  return (
    isReportAwaitingInput(report) ||
    (report.status === "ready" &&
      report.actionability === "immediately_actionable" &&
      report.already_addressed !== true)
  );
}
