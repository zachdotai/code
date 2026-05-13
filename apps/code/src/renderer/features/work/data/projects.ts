/**
 * Demo project data. The "posthog-code-launch" entry is anchored on real
 * PostHog Cloud dashboards in project 2 — IDs, names and recent counts were
 * pulled live via the PostHog MCP. The other two are placeholders.
 */

export interface ProjectDashboardRef {
  id: number;
  name: string;
  description: string;
  url: string;
  owner: string;
}

export interface ProjectAutomation {
  id: string;
  title: string;
  schedule: string;
  description: string;
  enabled: boolean;
}

export interface ProjectFile {
  id: string;
  name: string;
  updatedLabel: string;
}

export interface ProjectActivityEntry {
  id: string;
  kind: "automation" | "dashboard" | "task" | "file";
  text: string;
  when: string;
}

export interface ProjectHeadlineStat {
  label: string;
  value: string;
  delta: string;
  sparkline: number[];
  posthogUrl: string;
}

export interface ProjectMember {
  name: string;
  initials: string;
}

export interface Project {
  id: string;
  name: string;
  iconId: "rocket" | "microphone" | "megaphone";
  tagline: string;
  description: string;
  updatedLabel: string;
  members: ProjectMember[];
  isPlaceholder?: boolean;
  headline?: ProjectHeadlineStat;
  dashboards?: ProjectDashboardRef[];
  automations?: ProjectAutomation[];
  files?: ProjectFile[];
  activity?: ProjectActivityEntry[];
  pinnedSkills?: string[];
}

export const PROJECTS: Project[] = [
  {
    id: "posthog-code-launch",
    name: "PostHog Code launch",
    iconId: "rocket",
    tagline: "Launch week",
    description:
      "Coordinated launch of PostHog Code — waitlist conversion, ICP targeting, feedback monitoring, and billing health.",
    updatedLabel: "Updated just now",
    members: [
      { name: "Cleo Lant", initials: "CL" },
      { name: "Andy Vandervell", initials: "AV" },
      { name: "Andy Maguire", initials: "AM" },
      { name: "Pawel Cebula", initials: "PC" },
    ],
    headline: {
      label: "Waitlist signups · last 7 days",
      value: "1,548",
      delta: "+19× vs. prior 7 days",
      // Real daily counts pulled from PostHog (event subscribe_to_product_updates,
      // $pathname=/code, last 14 days, ending 2026-05-13).
      sparkline: [
        13, 19, 9, 4, 5, 11, 1136, 469, 163, 77, 49, 34, 51, 303, 402,
      ],
      posthogUrl: "https://us.posthog.com/project/2/dashboard/1550313",
    },
    dashboards: [
      {
        id: 1550313,
        name: "PostHog Code waitlist analysis",
        description:
          "Signups, conversion rate, traffic sources, and geo reach for posthog.com/code.",
        url: "https://us.posthog.com/project/2/dashboard/1550313",
        owner: "Andy V",
      },
      {
        id: 1472805,
        name: "PostHog Code ICP targets",
        description:
          "Three org segments that look like strong fits — small teams, error-tracking users, YC cohort.",
        url: "https://us.posthog.com/project/2/dashboard/1472805",
        owner: "Cleo",
      },
      {
        id: 1541474,
        name: "PostHog Code launch monitoring",
        description:
          "Seats, usage, Stripe quantities, and invoice lines from launch cutoff onward.",
        url: "https://us.posthog.com/project/2/dashboard/1541474",
        owner: "Pawel",
      },
      {
        id: 1312087,
        name: "PostHog Code feedback",
        description:
          "Live feed of /good, /bad, /feedback commands from inside PostHog Code.",
        url: "https://us.posthog.com/project/2/dashboard/1312087",
        owner: "Andy M",
      },
      {
        id: 1580654,
        name: "PostHog Code hackathon leaderboard",
        description:
          "Live leaderboard of AI spend per @posthog.com user during the launch-week hackathon.",
        url: "https://us.posthog.com/project/2/dashboard/1580654",
        owner: "Adam",
      },
    ],
    automations: [
      {
        id: "auto-waitlist-digest",
        title: "Daily waitlist digest",
        schedule: "Weekdays · 9:00am PT",
        description:
          "Posts yesterday's signups, top referring domains, and notable spikes to #posthog-code-launch.",
        enabled: true,
      },
      {
        id: "auto-conversion-alert",
        title: "Conversion-rate alert",
        schedule: "Hourly check",
        description:
          "Pings me if visit → waitlist conversion drops more than 30% week-over-week.",
        enabled: true,
      },
      {
        id: "auto-feedback-summary",
        title: "Friday feedback recap",
        schedule: "Fridays · 4:00pm PT",
        description:
          "Clusters /good, /bad, /feedback events from PostHog Code into themes and surfaces top 3.",
        enabled: false,
      },
    ],
    files: [
      {
        id: "f-launch-plan",
        name: "Launch plan.md",
        updatedLabel: "Yesterday",
      },
      {
        id: "f-icp-draft",
        name: "ICP segments draft.md",
        updatedLabel: "3 days ago",
      },
      {
        id: "f-hackathon-readme",
        name: "Hackathon README.md",
        updatedLabel: "Today",
      },
    ],
    activity: [
      {
        id: "act-1",
        kind: "automation",
        text: "Daily waitlist digest posted — 402 signups yesterday, ProductHunt is the top referrer.",
        when: "2h ago",
      },
      {
        id: "act-2",
        kind: "dashboard",
        text: "Pawel refreshed PostHog Code launch monitoring.",
        when: "5h ago",
      },
      {
        id: "act-3",
        kind: "task",
        text: 'PostHog Code asked: "draft a tweet thread summarizing today\'s signup spike."',
        when: "Yesterday",
      },
      {
        id: "act-4",
        kind: "file",
        text: "Hackathon README.md edited.",
        when: "Yesterday",
      },
    ],
    pinnedSkills: ["Marketing campaign digest", "Slack standup recap"],
  },
  {
    id: "customer-interviews-q2",
    name: "Customer interview synthesis",
    iconId: "microphone",
    tagline: "Q2 interviews",
    description:
      "Q2 customer conversations clustered into recurring themes, with linked transcripts and follow-ups.",
    updatedLabel: "Updated 2 days ago",
    members: [
      { name: "Cleo Lant", initials: "CL" },
      { name: "Andy Vandervell", initials: "AV" },
    ],
    isPlaceholder: true,
  },
  {
    id: "q3-marketing",
    name: "Q3 marketing campaigns",
    iconId: "megaphone",
    tagline: "Planning",
    description:
      "Cross-channel campaign plan for Q3 — owned dashboards, briefs, and the rollout calendar.",
    updatedLabel: "Updated 1 week ago",
    members: [{ name: "Cleo Lant", initials: "CL" }],
    isPlaceholder: true,
  },
];

export function getProject(id: string): Project | undefined {
  return PROJECTS.find((p) => p.id === id);
}
