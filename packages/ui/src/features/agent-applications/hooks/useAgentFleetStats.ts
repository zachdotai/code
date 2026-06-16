import type { AgentAggregateStats } from "@posthog/shared/agent-platform-types";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useAuthStateValue } from "../../auth/store";
import { agentApplicationsKeys } from "./agentApplicationsKeys";

/** Team-wide fleet roll-up stats (live count, spend, failures, approvals). */
export function useAgentFleetStats() {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  return useAuthenticatedQuery<AgentAggregateStats | null>(
    agentApplicationsKeys.fleetStats(projectId),
    (client) =>
      projectId ? client.getAgentFleetStats() : Promise.resolve(null),
    { enabled: !!projectId, staleTime: 30_000 },
  );
}
