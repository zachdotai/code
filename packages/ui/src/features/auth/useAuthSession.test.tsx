import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resetUser = vi.hoisted(() => vi.fn());
const hostResetUser = vi.hoisted(() => vi.fn());
const clearAuthScopedQueries = vi.hoisted(() => vi.fn());
const setStaleRegion = vi.hoisted(() => vi.fn());
const clearStaleRegion = vi.hoisted(() => vi.fn());

vi.mock("@posthog/ui/shell/analytics", () => ({
  identifyUser: vi.fn(),
  resetUser,
  setUserGroups: vi.fn(),
}));
vi.mock("@posthog/host-router/react", () => ({
  useHostTRPCClient: () => ({
    analytics: { resetUser: { mutate: hostResetUser } },
  }),
}));
vi.mock("./authQueries", () => ({
  clearAuthScopedQueries,
  getAuthIdentity: vi.fn(),
  refreshAuthStateQuery: vi.fn(),
  useAuthStateValue: vi.fn(),
  useCurrentUser: vi.fn(() => ({ data: undefined })),
}));
vi.mock("./authClient", () => ({
  useOptionalAuthenticatedClient: vi.fn(() => null),
}));
vi.mock("./authUiStateStore", () => ({
  useAuthUiStateStore: {
    getState: () => ({ setStaleRegion, clearStaleRegion }),
  },
}));
vi.mock("@posthog/ui/features/billing/seatStore", () => ({
  useSeatStore: { getState: () => ({ reset: vi.fn(), fetchSeat: vi.fn() }) },
}));
vi.mock("@posthog/ui/shell/logger", () => ({
  logger: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { useAuthIdentitySync } from "./useAuthSession";

describe("useAuthIdentitySync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not reset analytics identity before auth bootstrap completes", () => {
    renderHook(() => useAuthIdentitySync(null, null, false));

    expect(resetUser).not.toHaveBeenCalled();
    expect(hostResetUser).not.toHaveBeenCalled();
    expect(clearAuthScopedQueries).toHaveBeenCalledTimes(1);
  });

  it("resets analytics identity when logged out after bootstrap", () => {
    renderHook(() => useAuthIdentitySync(null, null, true));

    expect(resetUser).toHaveBeenCalledTimes(1);
    expect(hostResetUser).toHaveBeenCalledTimes(1);
  });

  it("resets exactly once across boot, login and logout", () => {
    const { rerender } = renderHook(
      ({
        identity,
        bootstrapComplete,
      }: {
        identity: string | null;
        bootstrapComplete: boolean;
      }) => useAuthIdentitySync(identity, null, bootstrapComplete),
      {
        initialProps: {
          identity: null as string | null,
          bootstrapComplete: false,
        },
      },
    );

    rerender({ identity: "user-1", bootstrapComplete: true });
    expect(resetUser).not.toHaveBeenCalled();
    expect(clearStaleRegion).toHaveBeenCalled();

    rerender({ identity: null, bootstrapComplete: true });
    expect(resetUser).toHaveBeenCalledTimes(1);
    expect(hostResetUser).toHaveBeenCalledTimes(1);
  });
});
