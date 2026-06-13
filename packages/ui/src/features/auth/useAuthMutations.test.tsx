import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const onLogout = vi.fn();
const getStateQuery = vi.fn();
const logoutMutate = vi.fn();

vi.mock("@posthog/host-router/react", () => ({
  useHostTRPCClient: () => ({
    auth: {
      getState: { query: getStateQuery },
      logout: { mutate: logoutMutate },
    },
  }),
}));

vi.mock("@posthog/di/react", () => ({
  useService: () => ({
    onLogout,
    onAuthSuccess: vi.fn(),
    beforeProjectSwitch: vi.fn(),
    onProjectSelected: vi.fn(),
  }),
}));

vi.mock("./authQueries", () => ({
  clearAuthScopedQueries: vi.fn(),
  refreshAuthStateQuery: vi.fn().mockResolvedValue(undefined),
}));

import { ANONYMOUS_AUTH_STATE, useAuthStore } from "./store";
import { useLogoutMutation } from "./useAuthMutations";

let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useLogoutMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    getStateQuery.mockResolvedValue({ cloudRegion: "us" });
    logoutMutate.mockResolvedValue(undefined);
    useAuthStore.setState({
      authState: {
        ...ANONYMOUS_AUTH_STATE,
        status: "authenticated",
        bootstrapComplete: true,
        cloudRegion: "us",
        currentOrgId: "org-1",
        currentProjectId: 1,
      },
    });
  });

  it("clears the auth store to anonymous on success without waiting for the subscription push", async () => {
    const { result } = renderHook(() => useLogoutMutation(), { wrapper });

    result.current.mutate();

    await waitFor(() =>
      expect(useAuthStore.getState().authState.status).toBe("anonymous"),
    );
    const state = useAuthStore.getState().authState;
    // bootstrapComplete stays true so App renders the auth screen, not the
    // boot spinner.
    expect(state.bootstrapComplete).toBe(true);
    expect(state.currentOrgId).toBeNull();
    expect(state.currentProjectId).toBeNull();
    expect(onLogout).toHaveBeenCalledWith("us");
  });
});
