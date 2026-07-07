import {
  formatTokens,
  formatUsd,
  formatWindow,
} from "@posthog/core/billing/spendAnalysisFormat";
import type { SpendAnalysisResponse } from "@posthog/core/billing/spendAnalysisTypes";
import type { DiscoveredTask } from "@posthog/core/setup/types";

export interface StaleFlagPayload {
  flagKey: string;
  references: { file: string; line: number; method: string }[];
  referenceCount: number;
}

export function buildStaleFlagSuggestion(
  flag: StaleFlagPayload,
): DiscoveredTask {
  const refs = flag.references;
  const first = refs[0];
  const moreCount = Math.max(0, flag.referenceCount - refs.length);
  const referencesBlock = refs
    .map((r) => `- ${r.file}:${r.line} (${r.method})`)
    .join("\n");
  const recommendation = `Remove the flag check and inline the winning branch. Code references:\n${referencesBlock}${moreCount > 0 ? `\n…and ${moreCount} more.` : ""}`;
  return {
    // Stable id keyed off the flag key so dismissal sticks across re-runs.
    id: `posthog-stale-flag-${flag.flagKey}`,
    source: "enricher",
    category: "stale_feature_flag",
    title: `Clean up stale flag "${flag.flagKey}"`,
    description: `\`${flag.flagKey}\` hasn't been evaluated in 30+ days but is still referenced in ${flag.referenceCount} place${flag.referenceCount === 1 ? "" : "s"} in this codebase.`,
    impact:
      "Stale flags accumulate dead code paths and conditional branches that nobody is exercising any more — they make refactors riskier and obscure what's actually live in production.",
    recommendation,
    file: first?.file,
    lineHint: first?.line,
    prompt: `/cleaning-up-stale-feature-flags Clean up stale flag "${flag.flagKey}"\n\n${recommendation}`,
  };
}

// Below this much PostHog Code spend in the analysis window there's nothing
// meaningful to optimize, so the suggestion stays hidden rather than nagging
// light users.
export const AI_USAGE_MIN_SPEND_USD = 5;

// Share of scoped spend a single tool must reach before it's called out as a
// hotspot in the suggestion description.
const AI_USAGE_HOTSPOT_SHARE = 0.35;

export function buildAiUsageSuggestion(
  data: SpendAnalysisResponse,
): DiscoveredTask | null {
  const { summary } = data;
  if (summary.scoped_cost_usd < AI_USAGE_MIN_SPEND_USD) return null;

  const window = formatWindow(summary.date_from, summary.date_to);
  const topTool = data.by_tool.items[0];
  const hotspot =
    topTool?.tool && topTool.share_of_scoped >= AI_USAGE_HOTSPOT_SHARE
      ? ` ${topTool.tool} alone drives ${Math.round(topTool.share_of_scoped * 100)}% of that, averaging ${formatTokens(topTool.avg_input_tokens)} input tokens per call.`
      : "";

  return {
    // Stable id so dismissal sticks across re-runs.
    id: "ai-usage-optimization",
    source: "enricher",
    category: "ai_usage",
    title: "Optimize your AI usage",
    description: `You've spent ${formatUsd(summary.scoped_cost_usd)} on PostHog Code in the last ${window}.${hotspot} Repeated workflows, re-explained context, and recurring one-off analyses usually hide easy savings.`,
    impact:
      "Token spend compounds quietly: the same context re-sent every session, the same analysis re-run every week. Capturing repeated work as skills and scheduled reports cuts cost — and gets you answers without having to ask.",
    recommendation:
      'Click "Implement as new task" — the agent audits your recent sessions and memory files, then proposes concrete changes ranked by impact: new skills for repeated workflows, memory-file edits, and scheduled reports for recurring questions.',
    prompt:
      "Audit how I've been using PostHog Code and find ways to get better results for fewer tokens. Review my recent sessions for: repeated workflows worth capturing as a reusable skill, recurring questions better served by a scheduled scout or AI report, memory files (CLAUDE.md, AGENTS.md) that are bloated, stale, or missing context I keep re-explaining, and prompts that ran long or retried because they were under-specified. Deliver a short report of findings ranked by impact — each with the evidence behind it and the estimated saving — then offer to implement the top quick wins.",
  };
}

export function buildSdkHealthSuggestion(): DiscoveredTask {
  return {
    id: "posthog-sdk-health",
    source: "enricher",
    category: "posthog_setup",
    title: "Check PostHog SDK health",
    description:
      "Run a quick health check on the PostHog SDKs installed in this repo: confirm they're on supported versions, flag anything outdated or deprecated, and bump the safely-upgradable ones.",
    impact:
      "Outdated SDKs miss bug fixes, security patches, and new features (newer event types, recording APIs, flag evaluation behavior). Catching version drift early avoids surprise breakage when you eventually upgrade.",
    recommendation:
      'Click "Implement as new task" — the agent uses the bundled diagnosing-sdk-health skill to inspect each PostHog SDK\'s version, compare it against the latest, and open a PR with safe bumps. Breaking-change upgrades are flagged for your review rather than applied automatically.',
    prompt: "/diagnosing-sdk-health",
  };
}

export function buildPosthogSetupSuggestion(
  state: "not_installed" | "installed_no_init",
): DiscoveredTask {
  if (state === "not_installed") {
    return {
      id: "posthog-setup",
      source: "enricher",
      category: "posthog_setup",
      title: "Set up PostHog",
      description:
        "PostHog isn't installed in this repo yet. Run this task to detect your framework, install the SDK, instrument analytics + error tracking + replay, and open a PR with the changes.",
      impact:
        "Without PostHog wired in, you have no visibility into how users interact with the product, no error or session-replay coverage, and no way to gate releases behind feature flags.",
      recommendation:
        'Click "Implement as new task" — the agent runs the bundled instrument-integration skill, sets up env vars, installs the SDK with your project\'s package manager, and opens a PR.',
      prompt: "/instrument-integration",
    };
  }
  return {
    id: "posthog-finish-init",
    source: "enricher",
    category: "posthog_setup",
    title: "Finish wiring PostHog",
    description:
      "The PostHog SDK is declared in this repo but `posthog.init(...)` (or the framework-equivalent provider) isn't called. Events won't be captured until that's wired up.",
    impact:
      "Until init runs, all PostHog calls are no-ops — you'll see no events in the project, no error reports, and no session replays despite the SDK being installed.",
    recommendation:
      'Click "Implement as new task" — the agent adds the init call and provider component for your framework, sets up the public-token + host env vars, and opens a PR. The SDK package itself is left alone.',
    prompt:
      "/instrument-integration\n\nThe SDK is already declared in this repo — skip install steps and focus on adding the init call, provider, and env vars.",
  };
}
