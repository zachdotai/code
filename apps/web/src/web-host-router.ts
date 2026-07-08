import { analyticsRouter } from "@posthog/host-router/routers/analytics.router";
import { authRouter } from "@posthog/host-router/routers/auth.router";
import { cloudTaskRouter } from "@posthog/host-router/routers/cloud-task.router";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import { z } from "zod";

// The in-browser slice of the host router. Electron serves the full hostRouter
// over IPC from its main process; the web host serves the subset the
// cloud-tasks-only surface needs, in the same JS context via localLink
// (web-trpc.ts). auth, cloudTask, and analytics are the REAL routers — their
// backing services (AuthService, CloudTaskService) are host-agnostic core code
// bound in web-container.ts. The rest are benign stubs for procedures the
// shared UI calls unconditionally on boot/mount. Anything not listed fails
// with NOT_FOUND at call time — same behavior as the HTTP dev stub this
// replaces, and a deliberate signal of where the web host is still thin.

const agentStubRouter = router({
  // SessionService subscribes to this in its constructor. No local agent
  // sessions exist on web, so hold the stream open and never emit.
  onSessionIdleKilled: publicProcedure.subscription(async function* (opts) {
    yield* [] as { taskRunId: string }[];
    await new Promise<void>((resolve) => {
      opts.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  }),
  // Called by resetSessionService() on logout/project switch.
  resetAll: publicProcedure.mutation(() => undefined),
});

const osStubRouter = router({
  openExternal: publicProcedure
    .input(z.object({ url: z.string() }))
    .mutation(({ input }) => {
      window.open(input.url, "_blank", "noopener,noreferrer");
    }),
});

const skillsStubRouter = router({
  // Queried when sending a message to resolve /skill commands. No local
  // skills directory exists on web.
  list: publicProcedure.query(() => []),
});

const additionalDirectoriesStubRouter = router({
  // Queried on task-input mount; only meaningful for local workspaces.
  listDefaults: publicProcedure.query(() => []),
});

const foldersStubRouter = router({
  // Queried on task-input mount to prefill a local repo path.
  getMostRecentlyAccessedRepository: publicProcedure.query(() => null),
});

const workspaceStubRouter = router({
  // useWorkspaces() at __root maps taskId -> local worktree/folder. No local
  // workspaces exist on web (cloud tasks run in the sandbox), so return an
  // empty map. A resolved (not rejected) query keeps the sidebar out of a
  // perpetual loading state.
  getAll: publicProcedure.query(() => ({}) as Record<string, unknown>),
  // Fired by __root's cloud-workspace reconcile effect (gated behind the
  // sync-cloud-tasks flag, off by default). Nothing to reconcile without a
  // local workspace backend.
  reconcileCloudWorkspaces: publicProcedure
    .input(z.object({ taskIds: z.array(z.string()) }))
    .mutation(() => ({ created: [] as string[] })),
});

export const webHostRouter = router({
  additionalDirectories: additionalDirectoriesStubRouter,
  agent: agentStubRouter,
  analytics: analyticsRouter,
  auth: authRouter,
  cloudTask: cloudTaskRouter,
  folders: foldersStubRouter,
  os: osStubRouter,
  skills: skillsStubRouter,
  workspace: workspaceStubRouter,
});

export type WebHostRouter = typeof webHostRouter;
