import { resolveService } from "@posthog/di/container";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";

// Module-level RTS adapters and services (no React context) reach the host
// tRPC client through DI, same as taskMetaApi/authQueries. Resolved lazily per
// call so importing these modules before the container is wired stays safe.
export function hostClient(): HostTrpcClient {
  return resolveService<HostTrpcClient>(HOST_TRPC_CLIENT);
}
