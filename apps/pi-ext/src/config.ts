import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createSignalsClient,
  type SignalsClient,
} from "@posthog/signals-client";

export interface PostHogConfig {
  apiHost: string;
  personalApiKey: string;
  projectId?: number;
  pollIntervalMs: number;
}

const DEFAULT_HOST = "https://us.posthog.com";
const DEFAULT_POLL_MS = 5 * 60 * 1000;

function readConfigFile(): Record<string, unknown> {
  const path = join(homedir(), ".pi", "agent", "posthog.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Resolve config from env first, then ~/.pi/agent/posthog.json. Returns null
 * when no API key is available, so the extension can prompt the user to log in.
 */
export function loadConfig(): PostHogConfig | null {
  const file = readConfigFile();
  const personalApiKey =
    process.env.POSTHOG_API_KEY ?? (file.personalApiKey as string | undefined);
  if (!personalApiKey) return null;

  const apiHost =
    process.env.POSTHOG_HOST ??
    (file.apiHost as string | undefined) ??
    DEFAULT_HOST;
  const projectId =
    asNumber(process.env.POSTHOG_PROJECT_ID) ?? asNumber(file.projectId);
  const pollIntervalMs =
    asNumber(process.env.POSTHOG_POLL_INTERVAL_MS) ??
    asNumber(file.pollIntervalMs) ??
    DEFAULT_POLL_MS;

  return {
    apiHost,
    personalApiKey,
    projectId,
    pollIntervalMs: pollIntervalMs > 0 ? pollIntervalMs : DEFAULT_POLL_MS,
  };
}

export function createClient(config: PostHogConfig): SignalsClient {
  return createSignalsClient({
    apiHost: config.apiHost,
    personalApiKey: config.personalApiKey,
    projectId: config.projectId,
    appVersion: "pi-ext",
  });
}
