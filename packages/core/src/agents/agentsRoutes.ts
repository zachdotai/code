/**
 * The agents surface (scouts + the agent-applications platform) is mounted under
 * both `/code/agents/*` (the Code view) and `/website/agents/*` (the Channels /
 * Bluebird view), sharing the same view components. Internal navigation resolves
 * its routes through the per-space map below so every `<Link>` / `navigate` stays
 * in the space the user is currently in instead of jumping back to `/code`.
 */
export type AgentsSpace = "code" | "website";

/** Which space a pathname belongs to. Defaults to `code` off the website tree. */
export function agentsSpaceFromPath(pathname: string): AgentsSpace {
  return pathname.startsWith("/website") ? "website" : "code";
}

/**
 * Every agents route, keyed by space. `$idOrSlug` / `$skillName` / `$sessionId`
 * params are filled in by the call site via TanStack's typed `params`.
 */
export const AGENTS_ROUTE = {
  code: {
    root: "/code/agents",
    scouts: "/code/agents/scouts",
    scoutDetail: "/code/agents/scouts/$skillName",
    scratchpad: "/code/agents/scouts/scratchpad",
    applications: "/code/agents/applications",
    fleetApprovals: "/code/agents/applications/approvals",
    application: "/code/agents/applications/$idOrSlug",
    configuration: "/code/agents/applications/$idOrSlug/configuration",
    sessions: "/code/agents/applications/$idOrSlug/sessions",
    sessionDetail: "/code/agents/applications/$idOrSlug/sessions/$sessionId",
    users: "/code/agents/applications/$idOrSlug/users",
    memory: "/code/agents/applications/$idOrSlug/memory",
    approvals: "/code/agents/applications/$idOrSlug/approvals",
    observability: "/code/agents/applications/$idOrSlug/observability",
    chat: "/code/agents/applications/$idOrSlug/chat",
  },
  website: {
    root: "/website/agents",
    scouts: "/website/agents/scouts",
    scoutDetail: "/website/agents/scouts/$skillName",
    scratchpad: "/website/agents/scouts/scratchpad",
    applications: "/website/agents/applications",
    fleetApprovals: "/website/agents/applications/approvals",
    application: "/website/agents/applications/$idOrSlug",
    configuration: "/website/agents/applications/$idOrSlug/configuration",
    sessions: "/website/agents/applications/$idOrSlug/sessions",
    sessionDetail: "/website/agents/applications/$idOrSlug/sessions/$sessionId",
    users: "/website/agents/applications/$idOrSlug/users",
    memory: "/website/agents/applications/$idOrSlug/memory",
    approvals: "/website/agents/applications/$idOrSlug/approvals",
    observability: "/website/agents/applications/$idOrSlug/observability",
    chat: "/website/agents/applications/$idOrSlug/chat",
  },
} as const satisfies Record<AgentsSpace, Record<string, string>>;

/** The set of route keys available per space. */
export type AgentsRouteKey = keyof (typeof AGENTS_ROUTE)["code"];
