import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import type { AuthState } from "@posthog/core/auth/schemas";
import type { CloudClientProvider } from "@posthog/core/local-store/sync/identifiers";
import { createAuthenticatedClient } from "../auth/authClientImperative";
import { useAuthStore } from "../auth/store";

/**
 * Bridges the sync engine (core) to the renderer's auth plumbing: builds an
 * authenticated PostHog client from the current auth state, caching per
 * auth-state reference so steady-state ticks reuse one client instance.
 */
export function createCloudClientProvider(): CloudClientProvider {
  let cached: { state: AuthState; client: PostHogAPIClient | null } | null =
    null;

  return {
    getClient(): PostHogAPIClient | null {
      const { authState } = useAuthStore.getState();
      if (!cached || cached.state !== authState) {
        cached = {
          state: authState,
          client: createAuthenticatedClient(authState),
        };
      }
      return cached.client;
    },
  };
}
