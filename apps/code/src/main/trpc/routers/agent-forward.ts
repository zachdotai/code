import type { ContentBlock } from "@agentclientprotocol/sdk";
import {
  cancelPermissionInput,
  cancelPromptInput,
  cancelSessionInput,
  getGatewayModelsInput,
  getGatewayModelsOutput,
  getPreviewConfigOptionsInput,
  getPreviewConfigOptionsOutput,
  listSessionsInput,
  listSessionsOutput,
  notifySessionContextInput,
  promptInput,
  promptOutput,
  reconnectSessionInput,
  recordActivityInput,
  respondToPermissionInput,
  rtkStatusOutput,
  sessionResponseSchema,
  setConfigOptionInput,
  startSessionInput,
  subscribeSessionInput,
} from "@posthog/workspace-server/services/agent/schemas";
import { container } from "../../di/container";
import { NODE_HOST_SERVICE } from "../../di/tokens";
import type { NodeHostService } from "../../services/node-host/service";
import { forwardSubscription } from "../../services/node-host/subscription-iterable";
import { publicProcedure, router } from "../trpc";

const agent = () =>
  container.get<NodeHostService>(NODE_HOST_SERVICE).getClient().agent;

/**
 * agent.* served by MAIN as one-line forwards over the node-host control
 * channel. The renderer talks to the node host directly over its own
 * MessagePort; this mirror keeps main serving the full HostRouter surface (the
 * `servesEveryHostRoute` check in router.ts), so a mis-routed call fails
 * loudly on a real procedure instead of NOT_FOUND, and non-window callers
 * still have a path.
 */
export const agentForwardRouter = router({
  start: publicProcedure
    .input(startSessionInput)
    .output(sessionResponseSchema)
    .mutation(({ input }) => agent().start.mutate(input)),

  prompt: publicProcedure
    .input(promptInput)
    .output(promptOutput)
    .mutation(({ input }) =>
      agent().prompt.mutate({
        ...input,
        prompt: input.prompt as ContentBlock[],
      }),
    ),

  cancel: publicProcedure
    .input(cancelSessionInput)
    .mutation(({ input }) => agent().cancel.mutate(input)),

  cancelPrompt: publicProcedure
    .input(cancelPromptInput)
    .mutation(({ input }) => agent().cancelPrompt.mutate(input)),

  rtkStatus: publicProcedure
    .output(rtkStatusOutput)
    .query(() => agent().rtkStatus.query()),

  reconnect: publicProcedure
    .input(reconnectSessionInput)
    .output(sessionResponseSchema.nullable())
    .mutation(({ input }) => agent().reconnect.mutate(input)),

  setConfigOption: publicProcedure
    .input(setConfigOptionInput)
    .mutation(({ input }) => agent().setConfigOption.mutate(input)),

  onSessionEvent: publicProcedure
    .input(subscribeSessionInput)
    .subscription(async function* (opts) {
      yield* forwardSubscription(
        (handlers) => agent().onSessionEvent.subscribe(opts.input, handlers),
        opts.signal,
      );
    }),

  onPermissionRequest: publicProcedure
    .input(subscribeSessionInput)
    .subscription(async function* (opts) {
      yield* forwardSubscription(
        (handlers) =>
          agent().onPermissionRequest.subscribe(opts.input, handlers),
        opts.signal,
      );
    }),

  respondToPermission: publicProcedure
    .input(respondToPermissionInput)
    .mutation(({ input }) => agent().respondToPermission.mutate(input)),

  cancelPermission: publicProcedure
    .input(cancelPermissionInput)
    .mutation(({ input }) => agent().cancelPermission.mutate(input)),

  listSessions: publicProcedure
    .input(listSessionsInput)
    .output(listSessionsOutput)
    .query(({ input }) => agent().listSessions.query(input)),

  notifySessionContext: publicProcedure
    .input(notifySessionContextInput)
    .mutation(({ input }) => agent().notifySessionContext.mutate(input)),

  hasActiveSessions: publicProcedure.query(() =>
    agent().hasActiveSessions.query(),
  ),

  onSessionsIdle: publicProcedure.subscription(async function* (opts) {
    yield* forwardSubscription(
      (handlers) => agent().onSessionsIdle.subscribe(undefined, handlers),
      opts.signal,
    );
  }),

  resetAll: publicProcedure.mutation(() => agent().resetAll.mutate()),

  recordActivity: publicProcedure
    .input(recordActivityInput)
    .mutation(({ input }) => agent().recordActivity.mutate(input)),

  onSessionIdleKilled: publicProcedure.subscription(async function* (opts) {
    yield* forwardSubscription(
      (handlers) => agent().onSessionIdleKilled.subscribe(undefined, handlers),
      opts.signal,
    );
  }),

  onAgentFileActivity: publicProcedure.subscription(async function* (opts) {
    yield* forwardSubscription(
      (handlers) => agent().onAgentFileActivity.subscribe(undefined, handlers),
      opts.signal,
    );
  }),

  getGatewayModels: publicProcedure
    .input(getGatewayModelsInput)
    .output(getGatewayModelsOutput)
    .query(({ input }) => agent().getGatewayModels.query(input)),

  getPreviewConfigOptions: publicProcedure
    .input(getPreviewConfigOptionsInput)
    .output(getPreviewConfigOptionsOutput)
    .query(({ input }) => agent().getPreviewConfigOptions.query(input)),
});
