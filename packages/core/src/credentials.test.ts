import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCredentials,
  clearCredentials,
  getValidAccessToken,
  isTokenExpired,
  loadCredentials,
  type StoredCredentials,
  saveCredentials,
} from "./credentials.ts";

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof os>();
  return { ...original, homedir: vi.fn(original.homedir) };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let tmpDir: string;

function makeCredentials(
  overrides: Partial<StoredCredentials> = {},
): StoredCredentials {
  return {
    region: "us",
    projectId: 42,
    refreshToken: "refresh-token",
    accessToken: "access-token",
    expiresAt: Date.now() + 3_600_000,
    ...overrides,
  };
}

describe("credentials", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "posthog-core-test-"));
    vi.mocked(os.homedir).mockReturnValue(tmpDir);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("saveCredentials / loadCredentials", () => {
    it("round-trips credentials to disk", () => {
      const creds = makeCredentials();
      saveCredentials(creds);
      const loaded = loadCredentials();
      expect(loaded).toEqual(creds);
    });

    it("creates parent directories if they do not exist", () => {
      const creds = makeCredentials();
      saveCredentials(creds);
      const configDir = path.join(tmpDir, ".config", "posthog-code");
      expect(fs.existsSync(configDir)).toBe(true);
    });

    it("returns null when no file exists", () => {
      expect(loadCredentials()).toBeNull();
    });
  });

  describe("clearCredentials", () => {
    it("removes the credentials file", () => {
      saveCredentials(makeCredentials());
      clearCredentials();
      expect(loadCredentials()).toBeNull();
    });

    it("does not throw if no file exists", () => {
      expect(() => clearCredentials()).not.toThrow();
    });
  });

  describe("isTokenExpired", () => {
    it("returns false when token has plenty of time left", () => {
      const creds = makeCredentials({ expiresAt: Date.now() + 120_000 });
      expect(isTokenExpired(creds)).toBe(false);
    });

    it("returns true when token is within the 60s expiry buffer", () => {
      const creds = makeCredentials({ expiresAt: Date.now() + 30_000 });
      expect(isTokenExpired(creds)).toBe(true);
    });

    it("returns true when token is already expired", () => {
      const creds = makeCredentials({ expiresAt: Date.now() - 1_000 });
      expect(isTokenExpired(creds)).toBe(true);
    });
  });

  describe("getValidAccessToken", () => {
    it("returns the stored token when it is still valid", async () => {
      const creds = makeCredentials({ expiresAt: Date.now() + 3_600_000 });
      const token = await getValidAccessToken(creds);
      expect(token).toBe("access-token");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("refreshes and returns a new token when expired", async () => {
      const expiredCreds = makeCredentials({
        expiresAt: Date.now() - 1_000,
      });
      saveCredentials(expiredCreds);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-access-token",
            expires_in: 3600,
            token_type: "Bearer",
            refresh_token: "new-refresh-token",
            scope: "*",
          }),
      });

      const token = await getValidAccessToken(expiredCreds);
      expect(token).toBe("new-access-token");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const stored = loadCredentials();
      expect(stored?.accessToken).toBe("new-access-token");
      expect(stored?.refreshToken).toBe("new-refresh-token");
    });

    it("propagates errors from the refresh endpoint", async () => {
      const expiredCreds = makeCredentials({ expiresAt: Date.now() - 1_000 });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve("token_expired"),
      });

      await expect(getValidAccessToken(expiredCreds)).rejects.toThrow("[401]");
    });
  });

  describe("buildCredentials", () => {
    it("computes expiresAt from expires_in", () => {
      const before = Date.now();
      const creds = buildCredentials("eu", 99, {
        access_token: "at",
        refresh_token: "rt",
        expires_in: 7200,
      });
      const after = Date.now();

      expect(creds.region).toBe("eu");
      expect(creds.projectId).toBe(99);
      expect(creds.accessToken).toBe("at");
      expect(creds.refreshToken).toBe("rt");
      expect(creds.expiresAt).toBeGreaterThanOrEqual(before + 7200 * 1000);
      expect(creds.expiresAt).toBeLessThanOrEqual(after + 7200 * 1000);
    });
  });
});
