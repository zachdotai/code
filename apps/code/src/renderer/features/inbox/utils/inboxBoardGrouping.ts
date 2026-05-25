import type { InboxBoardGroupBy } from "@features/inbox/stores/inboxSignalsFilterStore";
import { inboxStatusLabel } from "@features/inbox/utils/inboxSort";
import type {
  SignalReport,
  SignalReportActionability,
  SignalReportPriority,
  SignalReportStatus,
} from "@shared/types";

export interface BoardColumnDef {
  id: string;
  label: string;
  accent: string;
}

const STATUS_COLUMNS: BoardColumnDef[] = (
  [
    "ready",
    "pending_input",
    "in_progress",
    "failed",
    "candidate",
    "potential",
  ] as SignalReportStatus[]
).map((status) => ({
  id: status,
  label: inboxStatusLabel(status),
  accent: statusAccent(status),
}));

function statusAccent(status: SignalReportStatus): string {
  switch (status) {
    case "ready":
      return "var(--green-9)";
    case "pending_input":
      return "var(--violet-9)";
    case "in_progress":
      return "var(--amber-9)";
    case "candidate":
      return "var(--cyan-9)";
    case "potential":
      return "var(--gray-9)";
    case "failed":
      return "var(--red-9)";
    default:
      return "var(--gray-8)";
  }
}

const ACTIONABILITY_COLUMNS: BoardColumnDef[] = [
  {
    id: "immediately_actionable",
    label: "Actionable",
    accent: "var(--green-9)",
  },
  {
    id: "requires_human_input",
    label: "Needs input",
    accent: "var(--amber-9)",
  },
  {
    id: "not_actionable",
    label: "Not actionable",
    accent: "var(--gray-9)",
  },
  {
    id: "pending",
    label: "In pipeline",
    accent: "var(--violet-9)",
  },
];

const PRIORITY_COLUMNS: BoardColumnDef[] = [
  { id: "P0", label: "P0", accent: "var(--red-9)" },
  { id: "P1", label: "P1", accent: "var(--orange-9)" },
  { id: "P2", label: "P2", accent: "var(--amber-9)" },
  { id: "P3", label: "P3", accent: "var(--cyan-9)" },
  { id: "P4", label: "P4", accent: "var(--gray-9)" },
  { id: "unprioritized", label: "Unprioritized", accent: "var(--gray-8)" },
];

export function getBoardColumns(
  groupBy: InboxBoardGroupBy,
  visibleStatuses?: Set<SignalReportStatus>,
): BoardColumnDef[] {
  if (groupBy === "status") {
    return STATUS_COLUMNS.filter(
      (c) =>
        !visibleStatuses || visibleStatuses.has(c.id as SignalReportStatus),
    );
  }
  if (groupBy === "actionability") return ACTIONABILITY_COLUMNS;
  return PRIORITY_COLUMNS;
}

export function getReportColumnId(
  report: SignalReport,
  groupBy: InboxBoardGroupBy,
): string {
  if (groupBy === "status") {
    return report.status;
  }
  if (groupBy === "actionability") {
    if (report.status !== "ready") return "pending";
    const a: SignalReportActionability | null | undefined =
      report.actionability;
    if (a === "immediately_actionable") return "immediately_actionable";
    if (a === "requires_human_input") return "requires_human_input";
    if (a === "not_actionable") return "not_actionable";
    return "pending";
  }
  // priority
  const p: SignalReportPriority | null | undefined = report.priority;
  if (p === "P0" || p === "P1" || p === "P2" || p === "P3" || p === "P4") {
    return p;
  }
  return "unprioritized";
}

export function boardGroupByLabel(groupBy: InboxBoardGroupBy): string {
  switch (groupBy) {
    case "status":
      return "Status";
    case "actionability":
      return "Actionability";
    case "priority":
      return "Priority";
  }
}
