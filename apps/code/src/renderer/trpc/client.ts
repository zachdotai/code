import { ipcInstrumentationLink } from "@features/dev-toolbar/ipcInstrumentationLink";
import { ipcLink } from "@posthog/electron-trpc/renderer";
import type { HostRouter } from "@posthog/host-router/router";
import { portLink } from "@posthog/port-trpc/link";
import { createTRPCClient, type Operation, splitLink } from "@trpc/client";
import {
  createTRPCContext,
  createTRPCOptionsProxy,
} from "@trpc/tanstack-react-query";
import { queryClient } from "@utils/queryClient";
import type { TrpcRouter } from "../../main/trpc/router";
import { nodeHostBridge } from "./nodeHostPort";

// agent.* executes in the node-host utilityProcess; those operations flow over
// the renderer's direct MessagePort to it, bypassing main entirely. Everything
// else keeps the electron-trpc IPC link to main (which also still serves
// agent.* as a forwarding fallback, so a mis-route fails loudly).
const isAgentOperation = (op: Operation) => op.path.startsWith("agent.");

export const trpcClient = createTRPCClient<TrpcRouter>({
  links: [
    ipcInstrumentationLink<TrpcRouter>(),
    splitLink({
      condition: isAgentOperation,
      true: portLink({ bridge: nodeHostBridge }),
      false: ipcLink(),
    }),
  ],
});

export const hostTrpcClient = createTRPCClient<HostRouter>({
  links: [
    splitLink({
      condition: isAgentOperation,
      true: portLink({ bridge: nodeHostBridge }),
      false: ipcLink(),
    }),
  ],
});

const context = createTRPCContext<TrpcRouter>();
export const TRPCProvider = context.TRPCProvider;
export const useTRPC = context.useTRPC;

export const trpc = createTRPCOptionsProxy<TrpcRouter>({
  client: trpcClient,
  queryClient,
});
