import {
  Bug,
  ChartBar,
  ChartLine,
  ChartPieSlice,
  ChatCircleText,
  Code,
  Cube,
  CurrencyDollar,
  Flask,
  type Icon,
  SquaresFour,
  TrendDown,
  WarningOctagon,
  Wrench,
} from "@phosphor-icons/react";
import type { SuggestedPrompt } from "@posthog/ui/features/task-detail/components/SuggestedPromptCard";

// Starter prompts for the channels (project-bluebird) new-task surfaces. Picking
// one drops its `prompt` into the composer, ready to edit/send. Each prompt ends
// with a "User input:" block of fill-in lines the user completes before sending.
// Channels-only — the /code new-task screen keeps its discovery suggestions.
//
// On the channel home these are grouped behind the category chips below; the
// flat CHANNEL_TASK_SUGGESTIONS list (derived at the bottom) still feeds the
// new-task screen's card grid.
export interface SuggestionCategory {
  id: string;
  /** Chip label shown on the channel home. */
  label: string;
  icon: Icon;
  /** Radix color token base (`var(--<color>-N)`) for the chip + row icons. */
  color: string;
  suggestions: SuggestedPrompt[];
}

export const CHANNEL_SUGGESTION_CATEGORIES: SuggestionCategory[] = [
  {
    id: "code",
    label: "Code",
    icon: Code,
    color: "orange",
    suggestions: [
      {
        label: "Fix a bug",
        description: "Track down and fix a problem in the code",
        icon: Wrench,
        color: "orange",
        mode: "plan",
        prompt:
          "Help me fix a bug — track down the root cause in the code and implement a fix. Open a PR if appropriate.\n\n\nUser input:\n- Describe the bug / what's going wrong:\n- Steps to reproduce (optional):\n- Where it happens (file, page, area — optional):",
      },
      {
        label: "Build a new feature",
        description: "Design and implement something new",
        icon: Cube,
        color: "teal",
        mode: "plan",
        prompt:
          "Help me build a new feature — propose an approach, then implement it. Open a PR if appropriate.\n\n\nUser input:\n- Describe the feature you want:\n- Any constraints or requirements (optional):",
      },
    ],
  },
  {
    id: "analysis",
    label: "Analysis",
    icon: ChartLine,
    color: "blue",
    suggestions: [
      {
        label: "Run a feature analysis",
        description: "Adoption, engagement, and retention of a feature",
        icon: ChartLine,
        color: "blue",
        mode: "auto",
        prompt:
          "Analyze how a feature is performing — adoption, engagement, and retention of users who use it vs. those who don't.\n\n\nUser input:\n- Feature to analyze:\n- Time period (optional):",
      },
      {
        label: "Understand revenue patterns",
        description: "Trends over time, by plan, and by cohort",
        icon: CurrencyDollar,
        color: "green",
        mode: "auto",
        prompt:
          "Analyze our revenue trends — break it down over time, by plan, and by cohort, and call out notable changes and likely drivers.\n\n\nUser input:\n- What revenue question are you trying to answer:\n- Time period (optional):",
      },
      {
        label: "Summarize product usage",
        description: "Top events, active users, and key funnels",
        icon: ChartBar,
        color: "violet",
        mode: "auto",
        prompt:
          "Summarize how our product is being used — top events, active users, key funnels, and notable trends.\n\n\nUser input:\n- Product area or feature to focus on (optional):\n- Time period (optional):",
      },
      {
        label: "Interpret experiment results",
        description: "Significance and what to do next",
        icon: Flask,
        color: "purple",
        mode: "auto",
        prompt:
          "Interpret the results of an experiment — explain what the metrics show, whether it's significant, and what to do next.\n\n\nUser input:\n- Experiment name or key:\n- What decision are you trying to make (optional):",
      },
      {
        label: "Summarize user & agent feedback",
        description: "Common themes across recent feedback",
        icon: ChatCircleText,
        color: "amber",
        mode: "auto",
        prompt:
          "Summarize recent user and support/agent feedback — surface the common themes, complaints, and requests.\n\n\nUser input:\n- Feedback source or topic to focus on:\n- Time period (optional):",
      },
    ],
  },
  {
    id: "debug",
    label: "Debug",
    icon: Bug,
    color: "red",
    suggestions: [
      {
        label: "Debug a user issue",
        description: "Trace a specific user's events, replays, and errors",
        icon: Bug,
        color: "red",
        mode: "auto",
        prompt:
          "Help me debug an issue a specific user is hitting. Pull their recent events, session replays, and errors, then figure out what went wrong.\n\n\nUser input:\n- Describe the user issue:\n- User identifier (distinct ID, email address, etc):",
      },
      {
        label: "Investigate an error",
        description: "Root cause, frequency, and who it affects",
        icon: WarningOctagon,
        color: "red",
        mode: "auto",
        prompt:
          "Investigate an error or exception — find the root cause, how often it happens, and which users it affects.\n\n\nUser input:\n- Error message or issue:\n- Where you're seeing it (optional):",
      },
      {
        label: "Diagnose a metric change",
        description: "Why a metric dropped or spiked",
        icon: TrendDown,
        color: "amber",
        mode: "auto",
        prompt:
          "Figure out why a metric dropped or spiked — break it down by segment and surface the likely causes.\n\n\nUser input:\n- Which metric changed:\n- When you noticed it (optional):",
      },
    ],
  },
  {
    id: "canvas",
    label: "Canvas",
    icon: SquaresFour,
    color: "violet",
    suggestions: [
      {
        label: "Build a dashboard",
        description: "Lay out the key metrics on a canvas",
        icon: SquaresFour,
        color: "violet",
        mode: "auto",
        prompt:
          "Build a dashboard canvas that brings together the metrics that matter for this work.\n\n\nUser input:\n- What should the dashboard cover:\n- Key metrics or breakdowns to include (optional):",
      },
      {
        label: "Visualize a metric",
        description: "Chart a single metric with the right breakdowns",
        icon: ChartPieSlice,
        color: "purple",
        mode: "auto",
        prompt:
          "Create a canvas that visualizes a single metric over time, with the breakdowns that make it useful.\n\n\nUser input:\n- Metric to visualize:\n- Breakdowns or filters (optional):",
      },
    ],
  },
];

// Flat list for the new-task screen's card grid (WebsiteNewTask), which shows
// every starter prompt at once rather than grouping them behind chips.
export const CHANNEL_TASK_SUGGESTIONS: SuggestedPrompt[] =
  CHANNEL_SUGGESTION_CATEGORIES.flatMap((category) => category.suggestions);
