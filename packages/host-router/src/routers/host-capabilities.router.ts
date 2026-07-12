import { SLEEP_SERVICE } from "@posthog/core/sleep/identifiers";
import type { SleepService } from "@posthog/core/sleep/sleep";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import {
  AGENT_AUTH,
  AGENT_KNOWN_FOLDERS,
  AGENT_MCP_APPS,
  AGENT_PLUGIN_DIR,
  AGENT_POWER_MONITOR,
  AGENT_REPO_FILES,
  AGENT_SLEEP_COORDINATOR,
  AGENT_WORKSPACE_DIRECTORIES,
  AGENT_WORKTREE_SETTINGS,
} from "@posthog/workspace-server/services/agent/identifiers";
import type {
  AgentAuth,
  AgentKnownFolders,
  AgentMcpApps,
  AgentPluginDir,
  AgentPowerMonitor,
  AgentRepoFiles,
  AgentSleepCoordinator,
  AgentWorkspaceDirectories,
  AgentWorktreeSettings,
} from "@posthog/workspace-server/services/agent/ports";
import { SHELL_SERVICE } from "@posthog/workspace-server/services/shell/identifiers";
import type { ShellService } from "@posthog/workspace-server/services/shell/shell";
import { z } from "zod";

/**
 * The narrow main-process capability surface served TO the node-host
 * utilityProcess over its host-capabilities MessagePort. Everything the moved
 * AgentService still needs from main (power blocking, MCP apps, the fs
 * bridge, auth tokens, sqlite-backed workspace lookups, settings) is a
 * one-line forward over the same agent ports main already binds — sqlite and
 * electron-store never enter the utility bundle.
 */

/** Bridge a callback-registration event source into a subscription generator. */
async function* callbackEvents(
  register: (fire: () => void) => () => void,
  signal: AbortSignal | undefined,
): AsyncGenerator<true> {
  let wake: (() => void) | null = null;
  let fired = 0;
  const unregister = register(() => {
    fired += 1;
    wake?.();
    wake = null;
  });
  const onAbort = () => {
    wake?.();
    wake = null;
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (!signal?.aborted) {
      if (fired > 0) {
        fired -= 1;
        yield true;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    unregister();
  }
}

export const hostCapabilitiesRouter = router({
  sleep: router({
    acquire: publicProcedure
      .input(z.object({ activityId: z.string() }))
      .mutation(({ ctx, input }) =>
        ctx.container
          .get<AgentSleepCoordinator>(AGENT_SLEEP_COORDINATOR)
          .acquire(input.activityId),
      ),
    release: publicProcedure
      .input(z.object({ activityId: z.string() }))
      .mutation(({ ctx, input }) =>
        ctx.container
          .get<AgentSleepCoordinator>(AGENT_SLEEP_COORDINATOR)
          .release(input.activityId),
      ),
    cleanup: publicProcedure.mutation(({ ctx }) =>
      ctx.container.get<SleepService>(SLEEP_SERVICE).cleanup(),
    ),
  }),

  auth: router({
    getValidAccessToken: publicProcedure.mutation(({ ctx }) =>
      ctx.container.get<AgentAuth>(AGENT_AUTH).getValidAccessToken(),
    ),
    refreshAccessToken: publicProcedure.mutation(({ ctx }) =>
      ctx.container.get<AgentAuth>(AGENT_AUTH).refreshAccessToken(),
    ),
  }),

  mcpApps: router({
    handleDiscovery: publicProcedure
      .input(z.object({ serverNames: z.array(z.string()) }))
      .mutation(({ ctx, input }) =>
        ctx.container
          .get<AgentMcpApps>(AGENT_MCP_APPS)
          .handleDiscovery(input.serverNames),
      ),
    setServerConfigs: publicProcedure
      .input(
        z.object({
          configs: z.array(
            z.object({
              name: z.string(),
              url: z.string(),
              headers: z.record(z.string(), z.string()),
            }),
          ),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.container
          .get<AgentMcpApps>(AGENT_MCP_APPS)
          .setServerConfigs(input.configs),
      ),
    notifyToolInput: publicProcedure
      .input(
        z.object({
          toolKey: z.string(),
          toolCallId: z.string(),
          args: z.unknown(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.container
          .get<AgentMcpApps>(AGENT_MCP_APPS)
          .notifyToolInput(input.toolKey, input.toolCallId, input.args),
      ),
    notifyToolResult: publicProcedure
      .input(
        z.object({
          toolKey: z.string(),
          toolCallId: z.string(),
          result: z.unknown(),
          isError: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.container
          .get<AgentMcpApps>(AGENT_MCP_APPS)
          .notifyToolResult(
            input.toolKey,
            input.toolCallId,
            input.result,
            input.isError,
          ),
      ),
    notifyToolCancelled: publicProcedure
      .input(z.object({ toolKey: z.string(), toolCallId: z.string() }))
      .mutation(({ ctx, input }) =>
        ctx.container
          .get<AgentMcpApps>(AGENT_MCP_APPS)
          .notifyToolCancelled(input.toolKey, input.toolCallId),
      ),
    cleanup: publicProcedure.mutation(({ ctx }) =>
      ctx.container.get<AgentMcpApps>(AGENT_MCP_APPS).cleanup(),
    ),
  }),

  repoFiles: router({
    readRepoFile: publicProcedure
      .input(z.object({ repoPath: z.string(), filePath: z.string() }))
      .query(({ ctx, input }) =>
        ctx.container
          .get<AgentRepoFiles>(AGENT_REPO_FILES)
          .readRepoFile(input.repoPath, input.filePath),
      ),
    writeRepoFile: publicProcedure
      .input(
        z.object({
          repoPath: z.string(),
          filePath: z.string(),
          content: z.string(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.container
          .get<AgentRepoFiles>(AGENT_REPO_FILES)
          .writeRepoFile(input.repoPath, input.filePath, input.content),
      ),
  }),

  pluginDir: router({
    getPluginPath: publicProcedure.query(({ ctx }) =>
      ctx.container.get<AgentPluginDir>(AGENT_PLUGIN_DIR).getPluginPath(),
    ),
  }),

  workspaceDirectories: router({
    getAdditionalDirectories: publicProcedure
      .input(z.object({ taskId: z.string() }))
      .query(({ ctx, input }) =>
        ctx.container
          .get<AgentWorkspaceDirectories>(AGENT_WORKSPACE_DIRECTORIES)
          .getAdditionalDirectories(input.taskId),
      ),
  }),

  worktreeSettings: router({
    getWorktreeLocation: publicProcedure.query(({ ctx }) =>
      ctx.container
        .get<AgentWorktreeSettings>(AGENT_WORKTREE_SETTINGS)
        .getWorktreeLocation(),
    ),
  }),

  knownFolders: router({
    getFolders: publicProcedure.query(({ ctx }) =>
      ctx.container.get<AgentKnownFolders>(AGENT_KNOWN_FOLDERS).getFolders(),
    ),
  }),

  power: router({
    onResume: publicProcedure.subscription(async function* (opts) {
      const monitor =
        opts.ctx.container.get<AgentPowerMonitor>(AGENT_POWER_MONITOR);
      yield* callbackEvents((fire) => monitor.onResume(fire), opts.signal);
    }),
  }),

  shell: router({
    destroyAll: publicProcedure.mutation(({ ctx }) =>
      ctx.container.get<ShellService>(SHELL_SERVICE).destroyAll(),
    ),
  }),
});

export type HostCapabilitiesRouter = typeof hostCapabilitiesRouter;
