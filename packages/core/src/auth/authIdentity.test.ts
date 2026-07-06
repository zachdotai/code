import { describe, expect, it } from "vitest";
import { getAccountScope } from "./authIdentity";
import type { AuthState } from "./schemas";

const state = (partial: Partial<AuthState>): AuthState => ({
  status: "anonymous",
  bootstrapComplete: true,
  accountKey: null,
  cloudRegion: null,
  orgProjectsMap: {},
  currentOrgId: null,
  currentProjectId: null,
  hasCodeAccess: null,
  needsScopeReauth: false,
  ...partial,
});

describe("getAccountScope", () => {
  it("resolves the scope for a known authenticated identity", () => {
    expect(
      getAccountScope(
        state({
          status: "authenticated",
          accountKey: "user-1",
          cloudRegion: "us",
        }),
      ),
    ).toEqual({ accountKey: "user-1", cloudRegion: "us" });
  });

  it("is null when signed out", () => {
    expect(getAccountScope(state({ status: "anonymous" }))).toBeNull();
  });

  // Undefined = "don't know who this is yet", distinct from "signed out":
  // callers must leave per-user state untouched instead of clearing it.
  it.each([
    ["restoring", state({ status: "restoring", cloudRegion: "us" })],
    [
      "authenticated without accountKey",
      state({ status: "authenticated", cloudRegion: "us" }),
    ],
    [
      "authenticated without cloudRegion",
      state({ status: "authenticated", accountKey: "user-1" }),
    ],
  ])("is undefined while the identity is undetermined (%s)", (_name, s) => {
    expect(getAccountScope(s)).toBeUndefined();
  });
});
