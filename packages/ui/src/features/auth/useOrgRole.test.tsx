import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type UserResult = {
  data: { organization?: { membership_level: number } | null } | undefined;
  isLoading: boolean;
  isPlaceholderData: boolean;
};

let userResult: UserResult;

vi.mock("@posthog/ui/features/auth/authClient", () => ({
  useOptionalAuthenticatedClient: () => null,
}));

vi.mock("@posthog/ui/features/auth/useCurrentUser", () => ({
  useCurrentUser: () => userResult,
}));

import { ORGANIZATION_ADMIN_LEVEL, useIsOrgAdmin } from "./useOrgRole";

describe("useIsOrgAdmin", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns null while the user query is loading", () => {
    userResult = { data: undefined, isLoading: true, isPlaceholderData: false };
    const { result } = renderHook(() => useIsOrgAdmin());
    expect(result.current.isAdmin).toBeNull();
  });

  it("returns null while showing placeholder data carried across an org switch", () => {
    // Placeholder data is the *previous* org's membership, so an admin in the
    // old org must not read as admin in the one being switched to.
    userResult = {
      data: { organization: { membership_level: ORGANIZATION_ADMIN_LEVEL } },
      isLoading: false,
      isPlaceholderData: true,
    };
    const { result } = renderHook(() => useIsOrgAdmin());
    expect(result.current.isAdmin).toBeNull();
  });

  it("returns true for an admin once the current org resolves", () => {
    userResult = {
      data: { organization: { membership_level: ORGANIZATION_ADMIN_LEVEL } },
      isLoading: false,
      isPlaceholderData: false,
    };
    const { result } = renderHook(() => useIsOrgAdmin());
    expect(result.current.isAdmin).toBe(true);
  });

  it("returns false for a non-admin member", () => {
    userResult = {
      data: { organization: { membership_level: 1 } },
      isLoading: false,
      isPlaceholderData: false,
    };
    const { result } = renderHook(() => useIsOrgAdmin());
    expect(result.current.isAdmin).toBe(false);
  });

  it("returns null when the user has no organization", () => {
    userResult = {
      data: { organization: null },
      isLoading: false,
      isPlaceholderData: false,
    };
    const { result } = renderHook(() => useIsOrgAdmin());
    expect(result.current.isAdmin).toBeNull();
  });
});
