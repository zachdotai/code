import type { AuthState } from "@posthog/core/auth/schemas";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAuthSnapshot,
  loadAuthSnapshot,
  saveAuthSnapshot,
} from "./authSnapshot";

const authenticated: AuthState = {
  status: "authenticated",
  bootstrapComplete: true,
  cloudRegion: "us",
  orgProjectsMap: {},
  currentOrgId: "org-1",
  currentProjectId: 2,
  hasCodeAccess: true,
  needsScopeReauth: false,
};

describe("auth snapshot", () => {
  beforeEach(() => {
    clearAuthSnapshot();
  });

  it("round-trips an authenticated state and marks it bootstrapped", () => {
    saveAuthSnapshot(authenticated);
    const restored = loadAuthSnapshot();
    expect(restored?.status).toBe("authenticated");
    expect(restored?.currentProjectId).toBe(2);
    expect(restored?.bootstrapComplete).toBe(true);
  });

  it("never saves anonymous or un-bootstrapped states", () => {
    saveAuthSnapshot({
      ...authenticated,
      status: "anonymous",
    } as AuthState);
    expect(loadAuthSnapshot()).toBeNull();

    saveAuthSnapshot({ ...authenticated, bootstrapComplete: false });
    expect(loadAuthSnapshot()).toBeNull();
  });

  it("clears and tolerates corrupt storage", () => {
    saveAuthSnapshot(authenticated);
    clearAuthSnapshot();
    expect(loadAuthSnapshot()).toBeNull();

    globalThis.localStorage?.setItem(
      "posthog-code:auth-snapshot:v1",
      "{not json",
    );
    expect(loadAuthSnapshot()).toBeNull();
  });
});
