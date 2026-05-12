import * as crypto from "node:crypto";
import * as http from "node:http";
import type { Socket } from "node:net";

export type CloudRegion = "us" | "eu" | "dev";

const CLIENT_IDS: Record<CloudRegion, string> = {
  us: "HCWoE0aRFMYxIxFNTTwkOORn5LBjOt2GVDzwSw5W",
  eu: "AIvijgMS0dxKEmr5z6odvRd8Pkh5vts3nPTzgzU9",
  dev: "DC5uRLVbGI02YQ82grxgnK6Qn12SXWpCqdPb60oZ",
};

const CLOUD_URLS: Record<CloudRegion, string> = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
  dev: "http://localhost:8010",
};

const OAUTH_TIMEOUT_MS = 180_000; // 3 minutes

export interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token: string;
  scope?: string;
  scoped_teams?: number[];
}

export function getCloudUrl(region: CloudRegion): string {
  return CLOUD_URLS[region];
}

export function getClientId(region: CloudRegion): string {
  return CLIENT_IDS[region];
}

/** Generate a cryptographically random PKCE code verifier (43-128 chars, base64url). */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Derive the PKCE code challenge from a verifier using S256 method. */
export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/** Build the OAuth authorize URL with PKCE params. */
export function buildAuthorizeUrl(
  region: CloudRegion,
  codeVerifier: string,
  redirectUri: string,
): string {
  const challenge = generateCodeChallenge(codeVerifier);
  const params = new URLSearchParams({
    client_id: getClientId(region),
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "*",
    required_access_level: "project",
  });
  return `${getCloudUrl(region)}/oauth/authorize?${params.toString()}`;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  region: CloudRegion,
  redirectUri: string,
): Promise<OAuthTokenResponse> {
  const cloudUrl = getCloudUrl(region);
  const response = await fetch(`${cloudUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: getClientId(region),
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Token exchange failed [${response.status}]: ${text}`);
  }

  return response.json() as Promise<OAuthTokenResponse>;
}

/** Exchange a refresh token for a new access token. */
export async function refreshAccessToken(
  refreshToken: string,
  region: CloudRegion,
): Promise<OAuthTokenResponse> {
  const cloudUrl = getCloudUrl(region);
  const response = await fetch(`${cloudUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: getClientId(region),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Token refresh failed [${response.status}]: ${text}`);
  }

  return response.json() as Promise<OAuthTokenResponse>;
}

/**
 * Start a local HTTP callback server and wait for the OAuth redirect.
 * Resolves with the authorization code when the browser redirects back.
 * Opens the given authorizeUrl in the default browser.
 */
export function waitForOAuthCallback(
  authorizeUrl: string,
  port: number,
): Promise<string> {
  const baseUrl = `http://localhost:${port}`;

  return new Promise<string>((resolve, reject) => {
    const connections = new Set<Socket>();
    let settled = false;

    const settle = (code: string | Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      // Drain connections after a short delay so the browser can receive the response HTML
      setTimeout(() => {
        for (const conn of connections) {
          conn.destroy();
        }
        server.close();
      }, 500);
      if (code instanceof Error) {
        reject(code);
      } else {
        resolve(code);
      }
    };

    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end();
        return;
      }

      const url = new URL(req.url, baseUrl);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html" });
      if (code) {
        res.end(callbackHtml("success"));
        settle(code);
      } else {
        res.end(callbackHtml("error"));
        settle(new Error(`OAuth error: ${error ?? "unknown"}`));
      }
    });

    server.on("connection", (conn: Socket) => {
      connections.add(conn);
      conn.on("close", () => connections.delete(conn));
    });

    server.on("error", (err) => {
      settle(new Error(`Callback server error: ${err.message}`));
    });

    server.listen(port, "localhost", () => {
      openBrowser(authorizeUrl).catch((err) => {
        settle(new Error(`Failed to open browser: ${err.message}`));
      });
    });

    const timeoutId = setTimeout(() => {
      settle(new Error("Authorization timed out after 3 minutes"));
    }, OAUTH_TIMEOUT_MS);
  });
}

/** Find a free port by binding to port 0. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "localhost", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Could not determine free port"));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function openBrowser(url: string): Promise<void> {
  const { spawn } =
    require("node:child_process") as typeof import("node:child_process");
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "start"
        : "xdg-open";
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [url], { detached: true, stdio: "ignore" });
    child.on("error", reject);
    child.unref();
    resolve();
  });
}

function callbackHtml(status: "success" | "error"): string {
  const title = status === "success" ? "Login successful!" : "Login failed";
  const message =
    status === "success"
      ? "You can close this tab and return to the terminal."
      : "Something went wrong. Please try again.";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a1a2e;color:#eee}h1{font-size:1.5rem}p{color:#aaa}</style>
</head><body><h1>${title}</h1><p>${message}</p><script>setTimeout(()=>window.close(),1000)</script></body></html>`;
}
