import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CloudRegion } from "./oauth.ts";
import { refreshAccessToken } from "./oauth.ts";

export interface StoredCredentials {
  region: CloudRegion;
  projectId: number;
  refreshToken: string;
  accessToken: string;
  /** Unix ms timestamp when the access token expires. */
  expiresAt: number;
}

/** Refresh 60 seconds before actual expiry to account for clock skew. */
const EXPIRY_BUFFER_MS = 60_000;

function getConfigDir(): string {
  return path.join(os.homedir(), ".config", "posthog-code");
}

export function credentialsPath(): string {
  return path.join(getConfigDir(), "credentials.json");
}

export function loadCredentials(): StoredCredentials | null {
  try {
    const raw = fs.readFileSync(credentialsPath(), "utf8");
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: StoredCredentials): void {
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });
  const json = JSON.stringify(creds, null, 2);
  fs.writeFileSync(credentialsPath(), json, { mode: 0o600 });
}

export function clearCredentials(): void {
  try {
    fs.unlinkSync(credentialsPath());
  } catch {
    // Already gone — that's fine
  }
}

export function isTokenExpired(creds: StoredCredentials): boolean {
  return Date.now() >= creds.expiresAt - EXPIRY_BUFFER_MS;
}

/**
 * Return a valid access token, refreshing and persisting new tokens if the
 * stored one is about to expire.
 */
export async function getValidAccessToken(
  creds: StoredCredentials,
): Promise<string> {
  if (!isTokenExpired(creds)) {
    return creds.accessToken;
  }

  const tokenResponse = await refreshAccessToken(
    creds.refreshToken,
    creds.region,
  );

  const updated: StoredCredentials = {
    ...creds,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt: Date.now() + tokenResponse.expires_in * 1_000,
  };
  saveCredentials(updated);

  return updated.accessToken;
}

export function buildCredentials(
  region: CloudRegion,
  projectId: number,
  tokenResponse: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  },
): StoredCredentials {
  return {
    region,
    projectId,
    refreshToken: tokenResponse.refresh_token,
    accessToken: tokenResponse.access_token,
    expiresAt: Date.now() + tokenResponse.expires_in * 1_000,
  };
}
