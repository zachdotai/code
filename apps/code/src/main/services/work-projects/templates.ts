import type { NewTileInput, ProjectIconId } from "@shared/types/work-projects";

export type TemplateCategory =
  | "growth"
  | "engineering"
  | "product"
  | "ops"
  | "research";

export interface ProjectTemplate {
  id: string;
  name: string;
  tagline: string;
  iconId: ProjectIconId;
  category: TemplateCategory;
  /** One-line summary shown on the gallery card. */
  description: string;
  /** Tiles instantiated when the user picks this template. Receive
   *  fresh ids + `state: "live"` + `origin: "seed"` at create time. */
  tiles: NewTileInput[];
  /** Opening prompt fired as the first chat message after creation. */
  openingPrompt: string;
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "funnel-audit",
    name: "Funnel audit",
    tagline: "Find the worst drop-offs in a 30-day window",
    iconId: "target",
    category: "growth",
    description:
      "Audit a signup-to-activation funnel, surface the leakiest steps, and propose hypotheses for each.",
    tiles: [
      {
        type: "file",
        size: "md",
        filename: "hypotheses.md",
        contents: `# Funnel drop-off hypotheses\n\nThe agent will replace this with the actual leaks it finds and 2 concrete hypotheses for each.\n\n## Step → Step (pending)\n- Hypothesis 1: …\n- Hypothesis 2: …\n`,
      },
      {
        type: "note",
        size: "sm",
        body: "Are we measuring 'activation' the right way? Worth confirming the event definitions first.",
        tone: "yellow",
      },
    ],
    openingPrompt:
      "Audit our signup-to-activation funnel over the last 30 days. Use the PostHog tools to query the funnel, surface the worst drop-offs, propose two concrete hypotheses for each, and fill in the hypotheses.md file tile on the canvas.",
  },
  {
    id: "monday-brief",
    name: "Monday brief",
    tagline: "What changed in the product last week",
    iconId: "compass",
    category: "product",
    description:
      "A weekly briefing: top product events, behavior shifts, anything that looks like a regression.",
    tiles: [
      {
        type: "file",
        size: "md",
        filename: "brief.md",
        contents: `# Monday brief\n\n**Week:** (filled in by the agent)\n\n## Highlights\n- …\n\n## Watchlist\n- …\n\n## Regressions\n- …\n`,
      },
    ],
    openingPrompt:
      "Pull together this week's Monday brief: the top product events that moved last week, notable user-behavior shifts, and anything that looks like a regression. Fill in the brief.md file tile on the canvas and propose 1–2 headline tiles for the most-moved metrics.",
  },
  {
    id: "replay-digest",
    name: "Replay digest",
    tagline: "Three replays worth watching this week",
    iconId: "microphone",
    category: "research",
    description:
      "Pick three representative replays — one happy path, one friction moment, one outlier — and summarize each.",
    tiles: [
      {
        type: "file",
        size: "lg",
        filename: "digest.md",
        contents: `# Replay digest\n\n## Happy path\n_(agent will summarize a replay here)_\n\n## Friction\n_(agent will summarize a replay here)_\n\n## Outlier\n_(agent will summarize a replay here)_\n`,
      },
    ],
    openingPrompt:
      "Pick three session replays from the last 7 days worth me actually watching — one happy path, one friction moment, one weird outlier. Use the PostHog session-replay tools to find them, summarize each in the digest.md file tile, and propose note tiles with the share URLs.",
  },
  {
    id: "flag-hygiene",
    name: "Flag hygiene",
    tagline: "Stale and fully-rolled-out flags safe to remove",
    iconId: "flask",
    category: "engineering",
    description:
      "Audit feature flags — find the stale, fully rolled out, or unused ones safe to clean up.",
    tiles: [
      {
        type: "file",
        size: "lg",
        filename: "flags-to-remove.md",
        contents: `# Flag cleanup candidates\n\n| Flag key | Reason | Action |\n| --- | --- | --- |\n| _agent will fill_ | _agent will fill_ | _agent will fill_ |\n`,
      },
    ],
    openingPrompt:
      "Audit our PostHog feature flags. Find the stale ones, the fully-rolled-out ones, and the ones nothing is evaluating anymore. Fill in the flags-to-remove.md table tile with each cleanup candidate, the reason, and the safe action.",
  },
  {
    id: "voice-of-customer",
    name: "Voice of customer",
    tagline: "Surface what users are actually saying",
    iconId: "megaphone",
    category: "research",
    description:
      "Synthesize what customers said in tickets, interviews, and recent feedback into themes.",
    tiles: [
      {
        type: "file",
        size: "lg",
        filename: "themes.md",
        contents: `# Voice of customer · themes\n\n## Theme 1\n_evidence_\n\n## Theme 2\n_evidence_\n\n## Theme 3\n_evidence_\n`,
      },
    ],
    openingPrompt:
      "Surface the strongest customer-voice themes from the last 30 days using whatever customer-feedback tools are available (PostHog comments, tickets, interviews). Fill in the themes.md tile with 3 ranked themes plus supporting evidence quotes.",
  },
  {
    id: "growth-experiment",
    name: "Growth experiment",
    tagline: "Frame a hypothesis, find the metric, plan the test",
    iconId: "rocket",
    category: "growth",
    description:
      "Set up a growth experiment: pick the metric, write the hypothesis, scope the variant.",
    tiles: [
      {
        type: "file",
        size: "md",
        filename: "hypothesis.md",
        contents: `# Hypothesis\n\n**We believe** that …\n\n**For** _(user segment)_…\n\n**Will result in** _(measurable metric)_…\n\n**We'll know it worked when** …\n`,
      },
      {
        type: "note",
        size: "sm",
        body: "What's the smallest version of this test we can ship in a week?",
        tone: "blue",
      },
    ],
    openingPrompt:
      "Help me set up a growth experiment. Use the PostHog tools to find a target metric worth moving, draft a clean hypothesis in the hypothesis.md file tile, and propose a headline tile for the metric we'd track.",
  },
  {
    id: "launch-plan",
    name: "Launch plan",
    tagline: "Coordinate a feature launch end-to-end",
    iconId: "rocket",
    category: "ops",
    description:
      "Pull together a launch plan: the message, the rollout, the success metric, the comms.",
    tiles: [
      {
        type: "file",
        size: "lg",
        filename: "launch.md",
        contents: `# Launch plan\n\n## What we're shipping\n_…_\n\n## Audience & message\n_…_\n\n## Rollout\n- [ ] internal\n- [ ] beta\n- [ ] GA\n\n## Success metric\n_…_\n\n## Comms\n- [ ] blog\n- [ ] changelog\n- [ ] social\n`,
      },
    ],
    openingPrompt:
      "Help me draft a launch plan. Ask me what we're shipping, then propose a success-metric headline tile and fill in the launch.md template with the message, rollout phases, and comms checklist.",
  },
  {
    id: "onboarding-review",
    name: "Onboarding review",
    tagline: "Where are new users actually getting stuck?",
    iconId: "lightbulb",
    category: "product",
    description:
      "Diagnose onboarding: time-to-first-value, drop-off steps, friction signals.",
    tiles: [
      {
        type: "file",
        size: "lg",
        filename: "onboarding-findings.md",
        contents: `# Onboarding review · findings\n\n## Time to first value\n_…_\n\n## Drop-off step\n_…_\n\n## Friction signals\n_…_\n\n## Recommendations\n- _…_\n`,
      },
    ],
    openingPrompt:
      "Diagnose our new-user onboarding. Use PostHog to measure time-to-first-value, find the drop-off step, surface friction signals from replays. Fill in onboarding-findings.md and propose a headline tile for time-to-first-value.",
  },
];

export function getTemplateById(id: string): ProjectTemplate | null {
  return PROJECT_TEMPLATES.find((t) => t.id === id) ?? null;
}
