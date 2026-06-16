import type { AgentAggregateStats } from "@posthog/shared/agent-platform-types";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useAuthStateValue } from "../../auth/store";
import { agentApplicationsKeys } from "./agentApplicationsKeys";

/** Per-application roll-up stats (live, sessions, spend, failures). */
export function useAgentApplicationStats(idOrSlug: string) {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  return useAuthenticatedQuery<AgentAggregateStats | null>(
    agentApplicationsKeys.stats(projectId, idOrSlug),
    (client) => client.getAgentApplicationStats(idOrSlug),
    { enabled: !!projectId && !!idOrSlug, staleTime: 30_000 },
  );
}
