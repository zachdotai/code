import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  INBOX_SCOPE_ENTIRE_PROJECT,
  INBOX_SCOPE_FOR_YOU,
  type InboxScope,
  isAgentRunReport,
  isPullRequestReport,
  isReportTabReport,
  matchesInboxScope,
  orderedRunsTabReports,
} from "@posthog/core/inbox/reportMembership";
import type {
  DismissalReasonOptionValue,
  Signal,
  SignalReport,
} from "@posthog/signals-client";
import { Type } from "typebox";
import { createClient, loadConfig } from "./config";
import {
  buildWorkPrompt,
  FRIENDLY_SOURCE,
  friendlySource,
  latestRunBySkill,
  prNumber,
  reportDetail,
  reportLine,
  reportTitle,
  responderLine,
  responderMeta,
  scoutFleetHeader,
  scoutLimitsLine,
  scoutLine,
  scoutOutcome,
  sortPriorityFirst,
  sortResponders,
  taskLine,
  truncate,
} from "./format";

/** Which inbox tab a report list is being shown under; drives the action menu. */
type InboxTab = "pulls" | "reports" | "runs" | "archive";

const SETUP_MESSAGE =
  "PostHog signals are not configured. Set POSTHOG_API_KEY (a personal API key), " +
  "optionally POSTHOG_HOST (default https://us.posthog.com) and POSTHOG_PROJECT_ID, " +
  "or write ~/.pi/agent/posthog.json with { apiHost, personalApiKey, projectId }.";

const CADENCES = [30, 60, 120, 180, 360, 720, 1440];

const DISMISSAL_REASONS: {
  label: string;
  value: DismissalReasonOptionValue;
}[] = [
  { label: "Already fixed", value: "already_fixed" },
  { label: "Won't fix — intentional", value: "wontfix_intentional" },
  { label: "Won't fix — irrelevant", value: "wontfix_irrelevant" },
  { label: "Report unclear", value: "report_unclear" },
  { label: "Analysis wrong", value: "analysis_wrong" },
  { label: "Other", value: "other" },
];

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatCadence(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

function text(value: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text: value }], details: undefined };
}

function json(value: unknown): AgentToolResult<undefined> {
  return text(JSON.stringify(value, null, 2));
}

export default async function activate(pi: ExtensionAPI): Promise<void> {
  const config = loadConfig();
  if (!config) {
    pi.registerCommand("signals:setup", {
      description: "How to connect pi to PostHog signals",
      handler: async (_args, ctx) => {
        ctx.ui.notify(SETUP_MESSAGE, "warning");
      },
    });
    return;
  }

  const client = createClient(config);

  // ---- shared interactive flows -------------------------------------------

  async function loadSignals(reportId: string): Promise<Signal[]> {
    try {
      return (await client.inbox.signals(reportId)).signals;
    } catch {
      return [];
    }
  }

  async function suppressFlow(
    ctx: ExtensionCommandContext,
    report: SignalReport,
  ): Promise<void> {
    const reasonLabel = await ctx.ui.select(
      "Dismissal reason",
      DISMISSAL_REASONS.map((r) => r.label),
    );
    if (!reasonLabel) return;
    const reason = DISMISSAL_REASONS.find(
      (r) => r.label === reasonLabel,
    )?.value;
    const note = await ctx.ui.input("Note (optional)", "Why dismiss this?");
    await client.inbox.suppress(report.id, { reason, note: note || undefined });
    ctx.ui.notify("Report suppressed.", "info");
  }

  async function runLocally(
    ctx: ExtensionCommandContext,
    report: SignalReport,
    signals: Signal[],
  ): Promise<void> {
    const prompt = buildWorkPrompt(report, signals);
    ctx.ui.notify("Starting a pi session on this item…", "info");
    await ctx.newSession({
      withSession: async (sctx) => {
        await sctx.sendUserMessage(prompt);
      },
    });
  }

  async function runCloud(
    ctx: ExtensionCommandContext,
    report: SignalReport,
    signals: Signal[],
  ): Promise<void> {
    const task = await client.tasks.create({
      description: buildWorkPrompt(report, signals),
      title: reportTitle(report),
      signalReport: report.id,
      repository: process.env.POSTHOG_REPOSITORY,
    });
    const run = await client.tasks.createRun(task.id, { environment: "cloud" });
    await client.tasks.startRun(task.id, run.id);
    ctx.ui.notify(`Cloud task started: ${task.id} (run ${run.id}).`, "info");
  }

  async function reportActions(
    ctx: ExtensionCommandContext,
    report: SignalReport,
    signals: Signal[],
    tab: InboxTab,
  ): Promise<void> {
    for (;;) {
      const prUrl = report.implementation_pr_url;
      const actions: string[] = ["View details"];
      if (prUrl) actions.push(`Open PR ${prNumber(prUrl)}`.trim());
      if (tab === "archive") {
        // `resolved` is terminal (PR merged); only `suppressed` is restorable.
        if (report.status === "suppressed") actions.push("Restore to inbox");
      } else {
        actions.push(
          "Snooze 1 day",
          "Suppress…",
          "Work on this — locally (pi)",
          "Work on this — cloud task",
          "Reingest",
        );
      }
      actions.push("Back");

      const action = await ctx.ui.select(
        `${reportTitle(report)} — ${report.status}`,
        actions,
      );
      if (!action || action === "Back") return;
      try {
        if (action === "View details") {
          await ctx.ui.editor(
            reportTitle(report),
            reportDetail(report, signals),
          );
          continue;
        }
        if (action.startsWith("Open PR")) {
          if (prUrl) ctx.ui.notify(`Review: ${prUrl}`, "info");
          continue;
        }
        if (action === "Restore to inbox") {
          await client.inbox.setState(report.id, { state: "potential" });
          ctx.ui.notify("Restored to inbox.", "info");
        } else if (action === "Snooze 1 day") {
          await client.inbox.snooze(report.id, 86400);
          ctx.ui.notify("Snoozed for 1 day.", "info");
        } else if (action === "Suppress…") {
          await suppressFlow(ctx, report);
        } else if (action.startsWith("Work on this — locally")) {
          await runLocally(ctx, report, signals);
        } else if (action.startsWith("Work on this — cloud")) {
          await runCloud(ctx, report, signals);
        } else if (action === "Reingest") {
          await client.inbox.reingest(report.id);
          ctx.ui.notify("Reingestion started.", "info");
        }
      } catch (err) {
        ctx.ui.notify(`Action failed: ${errMsg(err)}`, "error");
      }
      return;
    }
  }

  async function pickFromList(
    ctx: ExtensionCommandContext,
    list: SignalReport[],
    tab: InboxTab,
    title: string,
  ): Promise<void> {
    if (list.length === 0) {
      ctx.ui.notify("Nothing in this tab.", "info");
      return;
    }
    const labels = list.map(reportLine);
    const choice = await ctx.ui.select(title, labels);
    if (!choice) return;
    const report = list[labels.indexOf(choice)];
    await reportActions(ctx, report, await loadSignals(report.id), tab);
  }

  async function editFilters(
    ctx: ExtensionCommandContext,
    priority: string | undefined,
    source: string | undefined,
  ): Promise<{ priority?: string; source?: string }> {
    const field = await ctx.ui.select("Filters", [
      "Priority…",
      "Source…",
      "Clear all",
      "Back",
    ]);
    if (!field || field === "Back") return { priority, source };
    if (field === "Clear all") return {};
    if (field === "Priority…") {
      const pick = await ctx.ui.select("Priority", [
        "All",
        "P0",
        "P1",
        "P2",
        "P3",
        "P4",
      ]);
      if (!pick) return { priority, source };
      return { priority: pick === "All" ? undefined : pick, source };
    }
    const labels = Object.values(FRIENDLY_SOURCE);
    const pick = await ctx.ui.select("Source", ["All", ...labels]);
    if (!pick) return { priority, source };
    if (pick === "All") return { priority, source: undefined };
    const codename = Object.entries(FRIENDLY_SOURCE).find(
      ([, label]) => label === pick,
    )?.[0];
    return { priority, source: codename };
  }

  async function scoutActions(
    ctx: ExtensionCommandContext,
    configId: string,
    skillName: string,
    enabled: boolean,
    emit: boolean,
  ): Promise<void> {
    const action = await ctx.ui.select(
      `${skillName} — ${enabled ? "enabled" : "disabled"}`,
      [
        enabled ? "Disable" : "Enable",
        "Set cadence…",
        emit ? "Switch to dry-run" : "Enable emitting",
        "View recent runs",
        "Back",
      ],
    );
    if (!action || action === "Back") return;
    try {
      if (action === "Enable" || action === "Disable") {
        await client.scouts.toggle(configId, { enabled: action === "Enable" });
        ctx.ui.notify(`Scout ${action.toLowerCase()}d.`, "info");
      } else if (action === "Set cadence…") {
        const options = CADENCES.map(formatCadence);
        const pick = await ctx.ui.select("Run interval", options);
        if (!pick) return;
        const minutes = CADENCES[options.indexOf(pick)];
        await client.scouts.toggle(configId, { runIntervalMinutes: minutes });
        ctx.ui.notify(`Cadence set to ${formatCadence(minutes)}.`, "info");
      } else if (action === "Switch to dry-run") {
        await client.scouts.toggle(configId, { emit: false });
        ctx.ui.notify("Scout set to dry-run (won't emit).", "info");
      } else if (action === "Enable emitting") {
        await client.scouts.toggle(configId, { emit: true });
        ctx.ui.notify("Scout will now emit findings.", "info");
      } else if (action === "View recent runs") {
        await scoutRunsView(ctx, skillName);
      }
    } catch (err) {
      ctx.ui.notify(`Action failed: ${errMsg(err)}`, "error");
    }
  }

  async function scoutRunsView(
    ctx: ExtensionCommandContext,
    skillName: string,
  ): Promise<void> {
    const runs = (await client.scouts.runs({ limit: 100 }))
      .filter((r) => r.skill_name === skillName)
      .slice(0, 20);
    if (runs.length === 0) {
      ctx.ui.notify("No runs yet.", "info");
      return;
    }
    const labels = runs.map(
      (r) =>
        `${r.started_at ?? "—"} · ${scoutOutcome(r)} · ${r.run_id.slice(0, 8)}`,
    );
    const choice = await ctx.ui.select(`${skillName} runs`, labels);
    if (!choice) return;
    const run = runs[labels.indexOf(choice)];
    const emissions = await client.scouts.emissions(run.run_id);
    const body = emissions.length
      ? emissions
          .map(
            (e) =>
              `- [${e.severity ?? "—"}] ${e.description} (confidence ${e.confidence})`,
          )
          .join("\n")
      : "No emissions for this run.";
    await ctx.ui.editor(
      `Run ${run.run_id.slice(0, 8)}`,
      `${run.summary ?? ""}\n\n${body}`,
    );
  }

  // ---- slash commands -----------------------------------------------------

  pi.registerCommand("inbox", {
    description:
      "Browse the PostHog inbox — tabs, filters, scope, act on items",
    handler: async (_args, ctx) => {
      let scope: InboxScope = INBOX_SCOPE_FOR_YOU;
      let priority: string | undefined;
      let source: string | undefined;

      for (;;) {
        let live: SignalReport[];
        try {
          live = (
            await client.inbox.list({
              ordering: "-total_weight",
              limit: 100,
              priority,
              source_product: source,
            })
          ).results;
        } catch (err) {
          ctx.ui.notify(`Failed to load inbox: ${errMsg(err)}`, "error");
          return;
        }

        // Mirror the desktop tabs: same membership predicates, same "For you"
        // (is_suggested_reviewer) vs "Entire project" scope, same priority-first order.
        const scoped = live.filter((r) => matchesInboxScope(r, scope));
        const pulls = sortPriorityFirst(scoped.filter(isPullRequestReport));
        const reports = sortPriorityFirst(scoped.filter(isReportTabReport));
        const runs = orderedRunsTabReports(scoped);
        const runsCount = scoped.filter(isAgentRunReport).length;

        const scopeLabel =
          scope === INBOX_SCOPE_FOR_YOU ? "For you" : "Entire project";
        const filterBits = [
          priority ? `priority ${priority}` : null,
          source ? friendlySource(source) : null,
        ].filter(Boolean);
        const filterLabel = filterBits.length
          ? ` (${filterBits.join(", ")})`
          : "";

        const choice = await ctx.ui.select("PostHog inbox", [
          `Pull requests (${pulls.length})`,
          `Reports (${reports.length})`,
          `Runs (${runsCount})`,
          "Archive",
          `Scope: ${scopeLabel} ↹`,
          `Filters${filterLabel}…`,
          "Quit",
        ]);
        if (!choice || choice === "Quit") return;

        if (choice.startsWith("Scope:")) {
          scope =
            scope === INBOX_SCOPE_FOR_YOU
              ? INBOX_SCOPE_ENTIRE_PROJECT
              : INBOX_SCOPE_FOR_YOU;
        } else if (choice.startsWith("Filters")) {
          const next = await editFilters(ctx, priority, source);
          priority = next.priority;
          source = next.source;
        } else if (choice.startsWith("Pull requests")) {
          await pickFromList(ctx, pulls, "pulls", "Pull requests");
        } else if (choice.startsWith("Reports")) {
          await pickFromList(ctx, reports, "reports", "Reports");
        } else if (choice.startsWith("Runs")) {
          await pickFromList(
            ctx,
            runs,
            "runs",
            "Runs (queued · live · finished)",
          );
        } else if (choice === "Archive") {
          // The live list excludes archived reports, so the Archive tab is its
          // own query for the terminal (suppressed/resolved) states.
          try {
            const archived = (
              await client.inbox.list({
                status: "suppressed,resolved",
                ordering: "-updated_at",
                limit: 50,
                priority,
                source_product: source,
              })
            ).results;
            await pickFromList(ctx, archived, "archive", "Archive");
          } catch (err) {
            ctx.ui.notify(`Failed to load archive: ${errMsg(err)}`, "error");
          }
        }
      }
    },
  });

  pi.registerCommand("scouts", {
    description: "Manage PostHog scouts (scheduled agents)",
    handler: async (_args, ctx) => {
      const [configs, runs, metadata] = await Promise.all([
        client.scouts.listConfigs(),
        // The scout-runs endpoint caps limit at 100.
        client.scouts.runs({ limit: 100 }),
        // Metadata is best-effort: a team not enrolled in scouts may 404 here.
        client.scouts
          .metadata()
          .catch(() => null),
      ]);
      if (configs.length === 0) {
        ctx.ui.notify("No scouts configured.", "info");
        return;
      }
      // Surface the early-access run budget + any announcement up front.
      if (metadata?.banner_message) {
        ctx.ui.notify(metadata.banner_message, "info");
      }

      const latest = latestRunBySkill(runs);
      // Fleet summary header (enabled/total + last dispatched + run budget),
      // mirroring the desktop "Scout fleet" card.
      const header = [
        scoutFleetHeader(configs),
        metadata ? scoutLimitsLine(metadata) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const labels = configs.map((c) => scoutLine(c, latest.get(c.skill_name)));
      const choice = await ctx.ui.select(`PostHog scouts — ${header}`, labels);
      if (!choice) return;
      const config = configs[labels.indexOf(choice)];
      await scoutActions(
        ctx,
        config.id,
        config.skill_name,
        config.enabled,
        config.emit,
      );
    },
  });

  pi.registerCommand("responders", {
    description: "Toggle PostHog responder sources (signal sources)",
    handler: async (_args, ctx) => {
      const sources = sortResponders(await client.responders.list());
      if (sources.length === 0) {
        ctx.ui.notify("No responder sources configured.", "info");
        return;
      }
      // Grouped by "PostHog data" / "Connected tools", with friendly labels and
      // a Watching/Off status — the desktop Responders cards as a list.
      const labels = sources.map(responderLine);
      const choice = await ctx.ui.select(
        "PostHog responders — each watches a source and files findings",
        labels,
      );
      if (!choice) return;
      const source = sources[labels.indexOf(choice)];
      const meta = responderMeta(source.source_product);
      const ok = await ctx.ui.confirm(
        `${meta.label} — ${source.enabled ? "Watching" : "Off"}`,
        `${meta.description}\n\n${source.enabled ? "Stop watching" : "Start watching"} ${meta.label}?`,
      );
      if (!ok) return;
      await client.responders.toggle(source.id, !source.enabled);
      ctx.ui.notify(
        `${meta.label} ${source.enabled ? "disabled" : "enabled"}.`,
        "info",
      );
    },
  });

  pi.registerCommand("tasks", {
    description: "View pi-originated PostHog tasks and their logs",
    handler: async (_args, ctx) => {
      const tasks = await client.tasks.list("pi");
      if (tasks.length === 0) {
        ctx.ui.notify("No pi-originated tasks yet.", "info");
        return;
      }
      const labels = tasks.map(taskLine);
      const choice = await ctx.ui.select("PostHog tasks (origin: pi)", labels);
      if (!choice) return;
      const task = tasks[labels.indexOf(choice)];
      const run = task.latest_run;
      if (!run) {
        ctx.ui.notify("This task has no runs.", "info");
        return;
      }
      const logs = await client.tasks.logs(task.id, run.id, { limit: 200 });
      const body = logs.length
        ? logs.map((entry) => truncate(JSON.stringify(entry), 200)).join("\n")
        : "No logs yet.";
      await ctx.ui.editor(`${task.title ?? task.id} — ${run.status}`, body);
    },
  });

  // ---- LLM-callable tools -------------------------------------------------

  pi.registerTool({
    name: "signals_inbox_list",
    label: "PostHog inbox: list",
    description:
      "List PostHog signal inbox reports (findings/work queued for review). Optional filters: status, priority (P0–P4), limit.",
    parameters: Type.Object({
      status: Type.Optional(Type.String()),
      priority: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      const { results, count } = await client.inbox.list({
        status: params.status,
        priority: params.priority,
        ordering: "-total_weight",
        limit: params.limit ?? 20,
      });
      return json({
        count,
        reports: results.map((r) => ({
          id: r.id,
          title: reportTitle(r),
          status: r.status,
          priority: r.priority,
          signal_count: r.signal_count,
        })),
      });
    },
  });

  pi.registerTool({
    name: "signals_inbox_get",
    label: "PostHog inbox: get",
    description:
      "Fetch a single PostHog inbox report with its contributing signals.",
    parameters: Type.Object({ reportId: Type.String() }),
    execute: async (_id, params) => {
      const report = await client.inbox.get(params.reportId);
      if (!report) return text(`No report ${params.reportId}.`);
      return json({ report, signals: await loadSignals(params.reportId) });
    },
  });

  pi.registerTool({
    name: "signals_inbox_act",
    label: "PostHog inbox: act",
    description:
      "Act on a PostHog inbox report: snooze it (seconds, default 1 day) or suppress it (with a dismissal reason and note).",
    parameters: Type.Object({
      reportId: Type.String(),
      action: Type.Union([Type.Literal("snooze"), Type.Literal("suppress")]),
      seconds: Type.Optional(Type.Number()),
      reason: Type.Optional(Type.String()),
      note: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) => {
      if (params.action === "snooze") {
        await client.inbox.snooze(params.reportId, params.seconds ?? 86400);
        return text(`Snoozed ${params.reportId}.`);
      }
      await client.inbox.suppress(params.reportId, {
        reason: params.reason as DismissalReasonOptionValue | undefined,
        note: params.note,
      });
      return text(`Suppressed ${params.reportId}.`);
    },
  });

  pi.registerTool({
    name: "scouts_list",
    label: "PostHog scouts: list",
    description:
      "List configured PostHog scouts (scheduled agents) with enabled/emit state and cadence.",
    parameters: Type.Object({}),
    execute: async () => {
      const configs = await client.scouts.listConfigs();
      return json(
        configs.map((c) => ({
          id: c.id,
          skill: c.skill_name,
          enabled: c.enabled,
          emit: c.emit,
          interval_minutes: c.run_interval_minutes,
          last_run_at: c.last_run_at,
        })),
      );
    },
  });

  pi.registerTool({
    name: "scout_toggle",
    label: "PostHog scouts: toggle",
    description:
      "Update a scout config: enable/disable, switch emit (dry-run) on/off, or change runIntervalMinutes.",
    parameters: Type.Object({
      configId: Type.String(),
      enabled: Type.Optional(Type.Boolean()),
      emit: Type.Optional(Type.Boolean()),
      runIntervalMinutes: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) => {
      const updated = await client.scouts.toggle(params.configId, {
        enabled: params.enabled,
        emit: params.emit,
        runIntervalMinutes: params.runIntervalMinutes,
      });
      return json({
        id: updated.id,
        enabled: updated.enabled,
        emit: updated.emit,
        interval_minutes: updated.run_interval_minutes,
      });
    },
  });

  pi.registerTool({
    name: "responders_list",
    label: "PostHog responders: list",
    description:
      "List PostHog responder sources (signal sources that feed the inbox) and whether each is enabled.",
    parameters: Type.Object({}),
    execute: async () => {
      const sources = await client.responders.list();
      return json(
        sources.map((s) => ({
          id: s.id,
          source_product: s.source_product,
          source_type: s.source_type,
          enabled: s.enabled,
        })),
      );
    },
  });

  pi.registerTool({
    name: "responder_toggle",
    label: "PostHog responders: toggle",
    description: "Enable or disable a PostHog responder source.",
    parameters: Type.Object({
      configId: Type.String(),
      enabled: Type.Boolean(),
    }),
    execute: async (_id, params) => {
      const updated = await client.responders.toggle(
        params.configId,
        params.enabled,
      );
      return json({ id: updated.id, enabled: updated.enabled });
    },
  });

  pi.registerTool({
    name: "task_create_and_run",
    label: "PostHog task: create + run",
    description:
      "Create a PostHog task and start a run (environment local or cloud, default cloud). Optionally link a signalReport.",
    parameters: Type.Object({
      description: Type.String(),
      title: Type.Optional(Type.String()),
      repository: Type.Optional(Type.String()),
      signalReport: Type.Optional(Type.String()),
      environment: Type.Optional(
        Type.Union([Type.Literal("local"), Type.Literal("cloud")]),
      ),
    }),
    execute: async (_id, params) => {
      const task = await client.tasks.create({
        description: params.description,
        title: params.title,
        repository: params.repository,
        signalReport: params.signalReport,
      });
      const environment = params.environment ?? "cloud";
      const run = await client.tasks.createRun(task.id, { environment });
      await client.tasks.startRun(task.id, run.id);
      return json({
        taskId: task.id,
        runId: run.id,
        environment,
        status: run.status,
      });
    },
  });

  pi.registerTool({
    name: "task_status",
    label: "PostHog task: status",
    description: "Get the status and structured output of a PostHog task run.",
    parameters: Type.Object({ taskId: Type.String(), runId: Type.String() }),
    execute: async (_id, params) => {
      const run = await client.tasks.status(params.taskId, params.runId);
      return json({
        id: run.id,
        status: run.status,
        stage: run.stage,
        branch: run.branch,
        output: run.output,
      });
    },
  });

  // ---- background inbox poller (TUI only) ---------------------------------

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let lastReadyCount = -1;

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const poll = async () => {
      try {
        const { results } = await client.inbox.list({
          status: "ready",
          ordering: "-total_weight",
          limit: 50,
        });
        const count = results.length;
        ctx.ui.setStatus(
          "posthog-inbox",
          count > 0 ? `◆ ${count} PostHog` : undefined,
        );
        if (lastReadyCount >= 0 && count > lastReadyCount) {
          ctx.ui.notify(
            `PostHog inbox: ${count} item(s) ready for review. Run /inbox.`,
            "info",
          );
        }
        lastReadyCount = count;
      } catch {
        // Network hiccup — try again on the next tick.
      }
    };
    void poll();
    pollTimer = setInterval(() => void poll(), config.pollIntervalMs);
    pollTimer.unref?.();
  });

  pi.on("session_shutdown", () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  });
}
