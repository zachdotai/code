import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";

export const APPLY_PIPELINE = Symbol.for(
  "posthog.core.localStore.applyPipeline",
);
export const SYNC_SCHEDULER = Symbol.for(
  "posthog.core.localStore.syncScheduler",
);
export const SYNC_ENGINE = Symbol.for("posthog.core.localStore.syncEngine");
export const SYNC_CLOUD_CLIENT_PROVIDER = Symbol.for(
  "posthog.core.localStore.cloudClientProvider",
);

/**
 * Supplies the currently-authenticated PostHog Cloud client to DeltaSources.
 * Returns null while logged out — sources skip their tick. Bound by the UI
 * layer (which owns auth state and token plumbing).
 */
export interface CloudClientProvider {
  getClient(): PostHogAPIClient | null;
}
