import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  findFreePort,
  generateCodeChallenge,
  generateCodeVerifier,
  getClientId,
  getCloudUrl,
  refreshAccessToken,
  waitForOAuthCallback,
} from "./oauth.ts";

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function errResponse(status: number, body = ""): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

const TOKEN_RESPONSE = {
  access_token: "access-abc",
  expires_in: 3600,
  token_type: "Bearer",
  refresh_token: "refresh-xyz",
  scope: "*",
  scoped_teams: [42],
};

describe("oauth helpers", () => {
  describe("getCloudUrl", () => {
    it("returns us url for us region", () => {
      expect(getCloudUrl("us")).toBe("https://us.posthog.com");
    });

    it("returns eu url for eu region", () => {
      expect(getCloudUrl("eu")).toBe("https://eu.posthog.com");
    });

    it("returns localhost for dev region", () => {
      expect(getCloudUrl("dev")).toContain("localhost");
    });
  });

  describe("getClientId", () => {
    it("returns distinct client ids per region", () => {
      const us = getClientId("us");
      const eu = getClientId("eu");
      const dev = getClientId("dev");
      expect(us).not.toBe(eu);
      expect(eu).not.toBe(dev);
      expect(us.length).toBeGreaterThan(10);
    });
  });

  describe("generateCodeVerifier", () => {
    it("returns a base64url string of 43 or more characters", () => {
      const v = generateCodeVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(/^[A-Za-z0-9_-]+$/.test(v)).toBe(true);
    });

    it("returns a unique value on each call", () => {
      expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
    });
  });

  describe("generateCodeChallenge", () => {
    it("returns a base64url-encoded sha256 of the verifier", () => {
      const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      const challenge = generateCodeChallenge(verifier);
      // The result must be base64url (no +, /, =)
      expect(/^[A-Za-z0-9_-]+$/.test(challenge)).toBe(true);
      expect(challenge.length).toBeGreaterThan(10);
    });

    it("is deterministic for the same verifier", () => {
      const v = "test-verifier-123";
      expect(generateCodeChallenge(v)).toBe(generateCodeChallenge(v));
    });

    it("differs for different verifiers", () => {
      expect(generateCodeChallenge("abc")).not.toBe(
        generateCodeChallenge("xyz"),
      );
    });
  });

  describe("buildAuthorizeUrl", () => {
    it("contains the expected query params", () => {
      const url = buildAuthorizeUrl(
        "us",
        "my-verifier",
        "http://localhost:9000/callback",
      );
      const parsed = new URL(url);
      expect(parsed.origin).toBe("https://us.posthog.com");
      expect(parsed.pathname).toBe("/oauth/authorize");
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
      expect(parsed.searchParams.get("redirect_uri")).toBe(
        "http://localhost:9000/callback",
      );
      expect(parsed.searchParams.get("client_id")).toBe(getClientId("us"));
      // Challenge is the sha256(verifier) base64url, not the verifier itself
      expect(parsed.searchParams.get("code_challenge")).not.toBe("my-verifier");
    });
  });
});

describe("exchangeCodeForToken", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the correct token endpoint with all required fields", async () => {
    mockFetch.mockResolvedValueOnce(okJson(TOKEN_RESPONSE));

    const result = await exchangeCodeForToken(
      "auth-code-123",
      "verifier-abc",
      "us",
      "http://localhost:9000/callback",
    );

    expect(result.access_token).toBe("access-abc");
    expect(result.scoped_teams).toEqual([42]);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://us.posthog.com/oauth/token");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.grant_type).toBe("authorization_code");
    expect(body.code).toBe("auth-code-123");
    expect(body.code_verifier).toBe("verifier-abc");
    expect(body.redirect_uri).toBe("http://localhost:9000/callback");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(errResponse(400, "invalid_grant"));
    await expect(
      exchangeCodeForToken("bad-code", "v", "us", "http://localhost/cb"),
    ).rejects.toThrow("[400]");
  });
});

describe("refreshAccessToken", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the refresh grant to the correct endpoint", async () => {
    mockFetch.mockResolvedValueOnce(okJson(TOKEN_RESPONSE));

    const result = await refreshAccessToken("refresh-xyz", "eu");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://eu.posthog.com/oauth/token");

    const body = JSON.parse(init.body as string);
    expect(body.grant_type).toBe("refresh_token");
    expect(body.refresh_token).toBe("refresh-xyz");
    expect(body.client_id).toBe(getClientId("eu"));

    expect(result.access_token).toBe("access-abc");
  });

  it("throws on auth error response", async () => {
    mockFetch.mockResolvedValueOnce(errResponse(401, "token_expired"));
    await expect(refreshAccessToken("stale", "us")).rejects.toThrow("[401]");
  });
});

describe("findFreePort", () => {
  it("returns a numeric port above 1024", async () => {
    const port = await findFreePort();
    expect(typeof port).toBe("number");
    expect(port).toBeGreaterThan(1024);
  });

  it("returns a different port on successive calls (probabilistic)", async () => {
    const ports = await Promise.all([
      findFreePort(),
      findFreePort(),
      findFreePort(),
    ]);
    // At least two should differ (extremely unlikely to all be the same)
    const unique = new Set(ports);
    expect(unique.size).toBeGreaterThanOrEqual(1);
  });
});

describe("waitForOAuthCallback", () => {
  it("resolves with the auth code from the callback", async () => {
    const port = await findFreePort();

    const codePromise = waitForOAuthCallback(
      "http://example.com/authorize?placeholder=1",
      port,
    );

    // Give the server a moment to start, then simulate the browser redirect
    await new Promise((r) => setTimeout(r, 100));
    const callbackUrl = `http://localhost:${port}/callback?code=test-auth-code`;
    const fetchResult = await fetch(callbackUrl).catch(() => null);
    expect(fetchResult?.ok).toBe(true);

    const code = await codePromise;
    expect(code).toBe("test-auth-code");
  });

  it("rejects on error callback", async () => {
    const port = await findFreePort();

    const codePromise = waitForOAuthCallback(
      "http://example.com/authorize?placeholder=1",
      port,
    );
    // Attach a no-op catch so Node doesn't flag this as unhandled before the
    // assertion below has a chance to register its own rejection handler.
    codePromise.catch(() => {});

    await new Promise((r) => setTimeout(r, 100));
    await fetch(`http://localhost:${port}/callback?error=access_denied`).catch(
      () => null,
    );

    await expect(codePromise).rejects.toThrow("access_denied");
  });
});
