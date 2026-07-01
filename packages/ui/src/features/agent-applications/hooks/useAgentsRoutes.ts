import {
  AGENTS_ROUTE,
  type AgentsSpace,
  agentsSpaceFromPath,
} from "@posthog/core/agents/agentsRoutes";
import { useRouterState } from "@tanstack/react-router";

/**
 * The navigation space the agents surface is currently rendered in — `code`
 * under `/code/agents/*`, `website` under `/website/agents/*`. The scouts and
 * agent-applications view components are shared across both subtrees, so they
 * read this to keep every link / navigate inside the active space.
 */
export function useAgentsSpace(): AgentsSpace {
  return useRouterState({
    select: (s) => agentsSpaceFromPath(s.location.pathname),
  });
}

/** The space-resolved agents route map for the current space. */
export function useAgentsRoutes() {
  return AGENTS_ROUTE[useAgentsSpace()];
}
