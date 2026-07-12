import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import type { AgentService } from "@posthog/workspace-server/services/agent/agent";
import { AGENT_SERVICE } from "@posthog/workspace-server/services/agent/identifiers";
import { AgentServiceEvent } from "@posthog/workspace-server/services/agent/schemas";
import { z } from "zod";

/**
 * Agent surface consumed only by the Electron MAIN process over the node-host
 * control channel (archive/suspension cancellation, git session env, the
 * dev-toolbar snapshot, usage-monitor activity). Never served to the renderer
 * — it is intentionally not part of HostRouter.
 */
export const agentInternalRouter = router({
  cancelSessionsByTaskId: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<AgentService>(AGENT_SERVICE)
        .cancelSessionsByTaskId(input.taskId),
    ),

  getSessionEnvForTask: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.container
        .get<AgentService>(AGENT_SERVICE)
        .getSessionEnvForTask(input.taskId),
    ),

  getDebugSnapshot: publicProcedure.query(({ ctx }) =>
    ctx.container.get<AgentService>(AGENT_SERVICE).getDebugSnapshot(),
  ),

  onLlmActivity: publicProcedure.subscription(async function* (opts) {
    const service = opts.ctx.container.get<AgentService>(AGENT_SERVICE);
    for await (const _ of service.toIterable(AgentServiceEvent.LlmActivity, {
      signal: opts.signal,
    })) {
      yield true;
    }
  }),
});

export type AgentInternalRouter = typeof agentInternalRouter;
