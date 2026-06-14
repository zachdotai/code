import { context, propagation } from "@opentelemetry/api";
import type { AppRouter } from "@posthog/workspace-server/trpc";
import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";
import superjson from "superjson";

const SECRET_HEADER = "x-workspace-secret";

function tracePropagationHeaders(
  base: Record<string, string>,
): Record<string, string> {
  const carrier: Record<string, string> = { ...base };
  propagation.inject(context.active(), carrier);
  return carrier;
}

export interface WorkspaceConnection {
  url: string;
  secret: string;
}

export type WorkspaceClient = ReturnType<typeof createWorkspaceClient>;

export function createWorkspaceClient(connection: WorkspaceConnection) {
  const url = `${connection.url.replace(/\/$/, "")}/trpc`;
  const headers = { [SECRET_HEADER]: connection.secret };
  const subscriptionUrl = `${url}?secret=${encodeURIComponent(connection.secret)}`;

  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: httpSubscriptionLink({
          url: subscriptionUrl,
          transformer: superjson,
        }),
        false: httpBatchLink({
          url,
          transformer: superjson,
          headers: () => tracePropagationHeaders(headers),
        }),
      }),
    ],
  });
}
