import {
  ChatsTeardrop,
  Crown,
  type IconProps,
  Target,
  Trophy,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";

export type SkillTag =
  | "product"
  | "growth"
  | "sales"
  | "customer"
  | "reporting";

export type SkillScope = "user" | "team";

export interface CatalogSkill {
  /** Stable id — matches the SKILL.md folder name in plugins/posthog/skills/. */
  id: string;
  scope: SkillScope;
  title: string;
  /** One-line tagline shown on the library card. */
  description: string;
  /** Friendly one-line "what you'll get out of this" pitch shown on the run screen. */
  outcome: string;
  /** 2–4 plain-English steps describing what happens when you click Run. */
  steps: string[];
  /** Things the user needs to have set up before this skill works well. */
  needs: string[];
  /** Estimated time before the result lands, e.g. "1–2 min". */
  estimatedTime: string;
  /** Trigger prompt sent to the agent. The skill body lives on disk. */
  prompt: string;
  tags: SkillTag[];
  icon: ComponentType<IconProps>;
  /** If true, seed an active WorkSkill on first hydration. */
  defaultActive: boolean;
}

export const SKILLS_CATALOG: CatalogSkill[] = [
  {
    id: "product-market-fit",
    scope: "user",
    title: "Product-Market Fit tracker",
    description:
      "Survey your users, watch retention, and find the right people to interview.",
    outcome:
      "Know whether your product has real PMF — and exactly who to talk to next.",
    steps: [
      "Ask a few quick questions about your product (name, your aha-moment event, your ideal customer)",
      "Create a Superhuman-style PMF survey for the right users in PostHog",
      "Build a retention & engagement dashboard pinned to your project",
      "Surface the users you should interview first",
    ],
    needs: ["PostHog account connected"],
    estimatedTime: "3–5 min",
    prompt:
      "Use the product-market-fit skill to help me measure and track product-market fit for our product. Start by walking me through the gather-context step.",
    tags: ["product", "customer"],
    icon: Target,
    defaultActive: true,
  },
  {
    id: "competitor-changelog-tracker",
    scope: "user",
    title: "Competitor changelog tracker",
    description:
      "Quietly track what your competitors are shipping, hiring for, and announcing.",
    outcome:
      "A Slack-ready summary of what your competitors have done lately — without doomscrolling.",
    steps: [
      "Ask which 4–8 competitors you want to track",
      "Skim each competitor's blog, changelog, jobs, social, and GitHub",
      "Flag launches, pricing changes, hiring patterns, and strategic shifts",
      "Hand back a Slack-ready summary you can paste into a channel",
    ],
    needs: ["Internet access (web search)"],
    estimatedTime: "2–4 min",
    prompt:
      "Use the competitor-changelog-tracker skill to run a competitor check. Ask me which competitors to look at and then produce the Slack-ready summary.",
    tags: ["growth"],
    icon: Trophy,
    defaultActive: false,
  },
  {
    id: "power-user-discovery",
    scope: "user",
    title: "Power user discovery",
    description:
      "Find the users who love your product most — and what makes them tick.",
    outcome:
      "A ranked list of your power users plus a saved cohort you can interview, message, or beta-test with.",
    steps: [
      "Confirm your most valuable events (e.g. 'ran analysis', 'created project')",
      "Score every user across frequency, time-in-app, value actions, and feature breadth",
      "Surface the top 10 with a clear leaderboard and key signals",
      "Save them as a 'Power Users' cohort in PostHog so you can act on it",
    ],
    needs: ["PostHog account connected"],
    estimatedTime: "1–2 min",
    prompt:
      "Use the power-user-discovery skill to find our power users in PostHog. Walk me through the gather-context step first.",
    tags: ["product", "customer"],
    icon: Crown,
    defaultActive: false,
  },
  {
    id: "important-slack-threads",
    scope: "user",
    title: "Important Slack threads",
    description:
      "Catch up on the threads that mattered without reading the whole week.",
    outcome:
      "A short digest of the long, controversial, and unresolved Slack threads from the last 7 days.",
    steps: [
      "Ask which Slack channels to scan (public only, unless you opt in)",
      "Pull threads with 10+ replies or 5+ distinct people",
      "Filter out banter, GIF chains, and pure social chatter",
      "Flag what's controversial, what's unresolved, and what got decided",
    ],
    needs: ["Slack MCP connected"],
    estimatedTime: "2–4 min",
    prompt:
      "Use the important-slack-threads skill to give me a Slack roundup from the last 7 days. Ask me which channels to scan.",
    tags: ["reporting"],
    icon: ChatsTeardrop,
    defaultActive: false,
  },
];

export function getUserCatalog(): CatalogSkill[] {
  return SKILLS_CATALOG.filter((s) => s.scope === "user");
}

export function getCatalogById(id: string): CatalogSkill | undefined {
  return SKILLS_CATALOG.find((s) => s.id === id);
}
