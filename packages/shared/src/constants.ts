export {
  BILLING_FLAG,
  DISCOVERY_RUN_FLAG,
  EXPERIMENT_SUGGESTIONS_FLAG,
  HOME_TAB_FLAG,
  SYNC_CLOUD_TASKS_FLAG,
} from "./flags";

export const SELF_DRIVING_SETUP_TASK_FLAG =
  "posthog-code-self-driving-setup-task";
export const BRANCH_PREFIX = "posthog-code/";

export const OTEL_TRACE_SAMPLE_RATIO = 0.02;

export const OTEL_BATCH_DELAY_MS = 2000;

export function buildTracesEndpoint(apiHost: string): string | null {
  let host = apiHost;
  while (host.endsWith("/")) {
    host = host.slice(0, -1);
  }
  const url = `${host}/i/v1/traces`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocalhost) {
    return null;
  }
  return url;
}
