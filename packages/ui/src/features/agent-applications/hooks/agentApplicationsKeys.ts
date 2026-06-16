export const agentApplicationsKeys = {
  list: (projectId: number | null) =>
    ["agent-applications", "list", projectId] as const,
  detail: (projectId: number | null, idOrSlug: string) =>
    ["agent-applications", "detail", projectId, idOrSlug] as const,
  stats: (projectId: number | null, idOrSlug: string) =>
    ["agent-applications", "stats", projectId, idOrSlug] as const,
  sessions: (projectId: number | null, idOrSlug: string) =>
    ["agent-applications", "sessions", projectId, idOrSlug] as const,
  session: (projectId: number | null, idOrSlug: string, sessionId: string) =>
    ["agent-applications", "session", projectId, idOrSlug, sessionId] as const,
  approvals: (projectId: number | null, idOrSlug: string) =>
    ["agent-applications", "approvals", projectId, idOrSlug] as const,
  revisions: (projectId: number | null, idOrSlug: string) =>
    ["agent-applications", "revisions", projectId, idOrSlug] as const,
  fleetStats: (projectId: number | null) =>
    ["agent-applications", "fleet", "stats", projectId] as const,
  fleetLiveSessions: (projectId: number | null) =>
    ["agent-applications", "fleet", "live-sessions", projectId] as const,
};
