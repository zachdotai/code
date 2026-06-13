import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = {
  status: "authenticated" as "authenticated" | "anonymous",
  bootstrapComplete: true,
  cloudRegion: "us" as "us" | "eu" | "dev" | null,
  orgProjectsMap: {},
  currentOrgId: "org-1" as string | null,
  currentProjectId: 1 as number | null,
  hasCodeAccess: true,
  needsScopeReauth: false,
};

vi.mock("./store", () => ({
  useAuthStateValue: (selector: (state: typeof authState) => unknown) =>
    selector(authState),
}));

import { useCurrentUser } from "./useCurrentUser";

/** A promise we resolve by hand, to hold a fetch in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useCurrentUser", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    authState.status = "authenticated";
    authState.cloudRegion = "us";
    authState.currentProjectId = 1;
  });

  it("keeps the previous user painted while a project/org switch re-fetches", async () => {
    const userA = { email: "a@example.com" } as Awaited<
      ReturnType<PostHogAPIClient["getCurrentUser"]>
    >;
    const userB = { email: "b@example.com" } as typeof userA;
    const first = deferred<typeof userA>();
    const second = deferred<typeof userA>();
    const getCurrentUser = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const client = { getCurrentUser } as unknown as PostHogAPIClient;

    const { result, rerender } = renderHook(() => useCurrentUser({ client }), {
      wrapper,
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);

    first.resolve(userA);
    await waitFor(() => expect(result.current.data).toEqual(userA));

    // Switch project: the query key carries currentProjectId, so this re-keys
    // to a fresh entry. The second fetch is held in flight.
    authState.currentProjectId = 2;
    rerender();

    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true));
    expect(result.current.data).toEqual(userA);

    second.resolve(userB);
    await waitFor(() => expect(result.current.data).toEqual(userB));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it("does not carry a placeholder user across logout", async () => {
    const userA = { email: "a@example.com" } as Awaited<
      ReturnType<PostHogAPIClient["getCurrentUser"]>
    >;
    const getCurrentUser = vi.fn().mockResolvedValue(userA);
    const client = { getCurrentUser } as unknown as PostHogAPIClient;

    const { result, rerender } = renderHook(() => useCurrentUser({ client }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toEqual(userA));

    // Sign out: identity becomes null, disabling the query and dropping the
    // placeholder so no stale user lingers on the signed-out screen.
    authState.status = "anonymous";
    authState.cloudRegion = null;
    authState.currentProjectId = null;
    rerender();

    expect(result.current.data).toBeUndefined();
  });
});
