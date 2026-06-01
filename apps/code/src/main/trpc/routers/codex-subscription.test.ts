import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: { ...actual, readFile: mockReadFile },
    readFile: mockReadFile,
  };
});

// Avoid loading electron-store (and electron) via the real settingsStore.
vi.mock("../../services/settingsStore", () => ({
  getUseCodexSubscription: vi.fn(() => false),
  setUseCodexSubscription: vi.fn(),
}));

import { readCodexStatus } from "./codex-subscription";

function makeIdToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

describe("readCodexStatus", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
  });

  it("reports signed out when ~/.codex/auth.json is missing", async () => {
    mockReadFile.mockRejectedValueOnce(
      Object.assign(new Error("nope"), { code: "ENOENT" }),
    );
    await expect(readCodexStatus()).resolves.toEqual({
      signedIn: false,
      accountEmail: null,
    });
  });

  it("reports signed in (no email) when only an API key is present", async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ OPENAI_API_KEY: "sk-test" }),
    );
    await expect(readCodexStatus()).resolves.toEqual({
      signedIn: true,
      accountEmail: null,
    });
  });

  it("extracts the email claim from the id_token", async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        tokens: { id_token: makeIdToken({ email: "dev@example.com" }) },
      }),
    );
    await expect(readCodexStatus()).resolves.toEqual({
      signedIn: true,
      accountEmail: "dev@example.com",
    });
  });

  it("reports signed in without an email when tokens lack an id_token", async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ tokens: { access_token: "abc" } }),
    );
    await expect(readCodexStatus()).resolves.toEqual({
      signedIn: true,
      accountEmail: null,
    });
  });

  it("treats an empty/credential-less file as signed out", async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ OPENAI_API_KEY: null }),
    );
    await expect(readCodexStatus()).resolves.toEqual({
      signedIn: false,
      accountEmail: null,
    });
  });
});
