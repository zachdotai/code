import type {
  ScoutConfig,
  ScoutMetadata,
  ScoutRun,
  Signal,
  SignalReport,
  SignalSourceConfig,
  Task,
} from "@posthog/signals-client";

/** Coarse "14m ago" relative time for fleet/run summaries. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function reportTitle(report: SignalReport): string {
  return report.title ?? report.summary ?? `Report ${report.id.slice(0, 8)}`;
}

/** Source-product codename → the label the desktop inbox shows. */
export const FRIENDLY_SOURCE: Record<string, string> = {
  signals_scout: "Scout",
  error_tracking: "Error tracking",
  github: "GitHub",
  linear: "Linear",
  zendesk: "Zendesk",
  conversations: "Support",
  session_replay: "Session replay",
  pganalyze: "pganalyze",
};

export function friendlySource(product: string): string {
  return FRIENDLY_SOURCE[product] ?? product;
}

/** "#17969" parsed from a GitHub PR URL, or "" when absent. */
export function prNumber(url: string | null | undefined): string {
  const match = url?.match(/\/pull\/(\d+)/);
  return match ? `#${match[1]}` : "";
}

/** P0…P4 → 0…4 for sorting; unprioritised sorts last. */
export function priorityRank(priority: string | null | undefined): number {
  if (!priority) return 9;
  const n = Number(priority.replace(/^P/i, ""));
  return Number.isFinite(n) ? n : 9;
}

/** "Priority first": by priority, then heaviest weight — the desktop's default order. */
export function sortPriorityFirst(reports: SignalReport[]): SignalReport[] {
  return [...reports].sort((a, b) => {
    const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
    return byPriority !== 0
      ? byPriority
      : (b.total_weight ?? 0) - (a.total_weight ?? 0);
  });
}

export function reportLine(report: SignalReport): string {
  const priority = report.priority ?? "P—";
  const source = report.source_products?.[0];
  const meta = [
    source ? friendlySource(source) : null,
    prNumber(report.implementation_pr_url),
    report.status,
  ].filter(Boolean);
  return `[${priority}] ${truncate(reportTitle(report), 60)} · ${meta.join(" · ")}`;
}

export function reportDetail(report: SignalReport, signals: Signal[]): string {
  const lines = [
    `# ${reportTitle(report)}`,
    "",
    `Status: ${report.status}    Priority: ${report.priority ?? "—"}    Actionability: ${report.actionability ?? "—"}`,
    `Signals: ${report.signal_count}    Weight: ${report.total_weight}    Sources: ${(report.source_products ?? []).join(", ") || "—"}`,
    report.implementation_pr_url ? `PR: ${report.implementation_pr_url}` : "",
    "",
    report.summary ?? "(no summary)",
    "",
    "## Contributing signals",
    ...signals
      .slice(0, 20)
      .map((s) => `- (${s.source_product}) ${truncate(s.content, 100)}`),
  ];
  return lines.filter((line) => line !== "").join("\n");
}

/** A lightweight last-run outcome (the desktop derives a richer set in core). */
export function scoutOutcome(run: ScoutRun | undefined): string {
  if (!run) return "never run";
  if (run.status === "in_progress" || run.status === "queued") return "running";
  if (run.status === "failed") return "error";
  if ((run.emitted_count ?? 0) > 0) return `emitted ${run.emitted_count}`;
  if (run.status === "completed") return "quiet";
  return run.status;
}

export function scoutLine(
  config: ScoutConfig,
  latest: ScoutRun | undefined,
): string {
  const flag = config.enabled ? "✓" : "·";
  const dry = config.emit ? "" : " (dry-run)";
  return `${flag} ${config.skill_name} · every ${config.run_interval_minutes}m · ${scoutOutcome(latest)}${dry}`;
}

/** Fleet header mirroring the desktop "56 of 60 scouts enabled · last dispatched 14m ago". */
export function scoutFleetHeader(configs: ScoutConfig[]): string {
  const enabled = configs.filter((c) => c.enabled).length;
  const lastDispatched = configs
    .map((c) => c.last_run_at)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  return `${enabled} of ${configs.length} scouts enabled · last dispatched ${timeAgo(lastDispatched)}`;
}

/** Early-access run budget, e.g. "runs today 3/5 · 2 left", or null when uncapped. */
export function scoutLimitsLine(metadata: ScoutMetadata): string | null {
  const { max_runs_per_day, runs_today, runs_remaining_today } =
    metadata.limits;
  if (max_runs_per_day == null) return null;
  const remaining =
    runs_remaining_today != null ? ` · ${runs_remaining_today} left` : "";
  return `runs today ${runs_today}/${max_runs_per_day}${remaining}`;
}

/**
 * Canonical responder copy, mirrored from the desktop's responderAgentMeta so
 * the TUI shows the same labels, descriptions, grouping, and alpha flags.
 */
export interface ResponderMeta {
  label: string;
  description: string;
  group: string;
  alpha?: boolean;
  order: number;
}

export const RESPONDER_META: Record<string, ResponderMeta> = {
  error_tracking: {
    label: "Error Tracking",
    description: "Bugs surfaced as new errors, regressions, and spikes.",
    group: "PostHog data",
    order: 0,
  },
  conversations: {
    label: "Support",
    description: "Problems customers raise in support.",
    group: "PostHog data",
    order: 1,
  },
  session_replay: {
    label: "Session Replay",
    description: "UX problems found in session recordings.",
    group: "PostHog data",
    alpha: true,
    order: 2,
  },
  github: {
    label: "GitHub Issues",
    description: "Issues filed in GitHub.",
    group: "Connected tools",
    order: 3,
  },
  linear: {
    label: "Linear",
    description: "Issues tracked in Linear.",
    group: "Connected tools",
    order: 4,
  },
  zendesk: {
    label: "Zendesk",
    description: "Incoming Zendesk tickets.",
    group: "Connected tools",
    order: 5,
  },
  pganalyze: {
    label: "pganalyze",
    description:
      "Postgres performance problems – slow queries and bad indexes.",
    group: "Connected tools",
    order: 6,
  },
};

export function responderMeta(product: string): ResponderMeta {
  return (
    RESPONDER_META[product] ?? {
      label: product,
      description: "",
      group: "Other",
      order: 99,
    }
  );
}

/** Sort responder configs by group/order to match the desktop layout. */
export function sortResponders(
  sources: SignalSourceConfig[],
): SignalSourceConfig[] {
  return [...sources].sort(
    (a, b) =>
      responderMeta(a.source_product).order -
      responderMeta(b.source_product).order,
  );
}

export function responderLine(source: SignalSourceConfig): string {
  const meta = responderMeta(source.source_product);
  const status = source.enabled ? "Watching" : "Off";
  const alpha = meta.alpha ? " · alpha" : "";
  return `${meta.group} · ${meta.label} — ${status}${alpha}`;
}

export function taskLine(task: Task): string {
  const status = task.latest_run?.status ?? "no runs";
  return `${truncate(task.title ?? task.slug ?? task.id, 56)} · ${status}`;
}

/** Most-recent run per scout skill, keyed by skill_name. */
export function latestRunBySkill(runs: ScoutRun[]): Map<string, ScoutRun> {
  const latest = new Map<string, ScoutRun>();
  for (const run of runs) {
    const current = latest.get(run.skill_name);
    const runTime = run.started_at ?? "";
    const currentTime = current?.started_at ?? "";
    if (!current || runTime > currentTime) latest.set(run.skill_name, run);
  }
  return latest;
}

/** Build the prompt handed to the agent (local run) or cloud task when acting on a report. */
export function buildWorkPrompt(
  report: SignalReport,
  signals: Signal[],
): string {
  return [
    `Work on this PostHog inbox item (report ${report.id}).`,
    "",
    `Title: ${reportTitle(report)}`,
    `Priority: ${report.priority ?? "—"}    Actionability: ${report.actionability ?? "—"}`,
    "",
    "Summary:",
    report.summary ?? "(no summary)",
    "",
    "Contributing signals:",
    ...signals
      .slice(0, 20)
      .map((s) => `- (${s.source_product}) ${truncate(s.content, 200)}`),
    "",
    "Investigate the root cause in this repository and propose (or implement) a fix.",
  ].join("\n");
}
