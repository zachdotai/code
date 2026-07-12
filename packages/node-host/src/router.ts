import type { HostRouter } from "@posthog/host-router/router";
import { agentRouter } from "@posthog/host-router/routers/agent.router";
import { agentInternalRouter } from "@posthog/host-router/routers/agent-internal.router";
import { router } from "@posthog/host-trpc/trpc";

/**
 * Everything the node-host utilityProcess serves: the renderer-facing agent
 * routes (identical, by construction, to HostRouter's `agent`) plus the
 * main-only internal surface used over the control channel.
 */
export const nodeHostRouter = router({
  agent: agentRouter,
  agentInternal: agentInternalRouter,
});

export type NodeHostRouter = typeof nodeHostRouter;

/**
 * The renderer routes agent.* here directly (splitLink), so every agent route
 * in HostRouter must be served by this assembly — a missing one would fail
 * only at runtime with NOT_FOUND. When this assignment errors, its expected
 * type names the missing routes.
 */
type MissingAgentRoutes = Exclude<
  keyof HostRouter["agent"],
  keyof NodeHostRouter["agent"]
>;
export const servesEveryAgentRoute: [MissingAgentRoutes] extends [never]
  ? true
  : MissingAgentRoutes = true;
