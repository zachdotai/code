export const CLOUD_TASK_SERVICE = Symbol.for("posthog.core.cloudTaskService");
export const CLOUD_TASK_AUTH = Symbol.for("posthog.core.cloudTaskAuth");
export const CLOUD_TASK_CONNECTIVITY = Symbol.for(
  "posthog.core.cloudTaskConnectivity",
);

export interface ICloudTaskAuth {
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
}

/**
 * Reports real network connectivity to the cloud-run stream watcher so a local
 * outage doesn't burn the reconnect budget and surface a hard error for a run
 * that is still executing server-side. The host adapter wraps the
 * workspace-server ConnectivityService (the single connectivity source).
 */
export interface ICloudTaskConnectivity {
  isOnline(): boolean;
  /**
   * Invokes `callback` on each offline→online transition. Returns an
   * unsubscribe function. Multiple subscribers are fanned out independently.
   */
  onOnline(callback: () => void): () => void;
}
