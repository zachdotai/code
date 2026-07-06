import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import { resolveService } from "@posthog/di/container";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import { createAuthenticatedClient as createClient } from "./authClient";
import { type AuthState, fetchAuthState } from "./authQueries";
import { createCachedTokenAccessors } from "./tokenCache";

function hostClient(): HostTrpcClient {
  return resolveService<HostTrpcClient>(HOST_TRPC_CLIENT);
}

const { getValidAccessToken, refreshAccessToken } = createCachedTokenAccessors({
  getValidAccessToken: async () => {
    const { accessToken } = await hostClient().auth.getValidAccessToken.query();
    return accessToken;
  },
  refreshAccessToken: async () => {
    const { accessToken } = await hostClient().auth.refreshAccessToken.mutate();
    return accessToken;
  },
});

export function createAuthenticatedClient(
  authState: AuthState | null | undefined,
): PostHogAPIClient | null {
  return createClient(authState, getValidAccessToken, refreshAccessToken);
}

export async function getAuthenticatedClient(): Promise<PostHogAPIClient | null> {
  return createAuthenticatedClient(await fetchAuthState());
}
