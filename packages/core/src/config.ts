import { getValidAccessToken, loadCredentials } from "./credentials.ts";
import { getCloudUrl } from "./oauth.ts";
import type { ClientConfig } from "./types.ts";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Resolve a ClientConfig for use with PostHogClient.
 *
 * Resolution order:
 *  1. Environment variables (POSTHOG_API_KEY + POSTHOG_PROJECT_ID) — useful in CI
 *  2. Stored OAuth credentials (~/.config/posthog-code/credentials.json)
 *
 * Throws ConfigError if neither source is available.
 */
export async function loadConfig(): Promise<ClientConfig> {
  const envKey = process.env.POSTHOG_API_KEY;
  const envProject = process.env.POSTHOG_PROJECT_ID;
  const envHost = process.env.POSTHOG_HOST?.replace(/\/$/, "");

  if (envKey && envProject) {
    const projectId = Number(envProject);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new ConfigError("POSTHOG_PROJECT_ID must be a positive integer");
    }
    return {
      apiUrl: envHost ?? "https://us.posthog.com",
      apiKey: envKey,
      projectId,
    };
  }

  const creds = loadCredentials();
  if (creds) {
    const accessToken = await getValidAccessToken(creds);
    return {
      apiUrl: getCloudUrl(creds.region),
      apiKey: accessToken,
      projectId: creds.projectId,
    };
  }

  const missing: string[] = [];
  if (!envKey) missing.push("POSTHOG_API_KEY");
  if (!envProject) missing.push("POSTHOG_PROJECT_ID");

  throw new ConfigError(
    `Not authenticated. Run \`posthog-code login\` or set ${missing.join(" and ")} environment variables.`,
  );
}
