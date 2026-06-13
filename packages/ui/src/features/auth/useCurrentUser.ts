import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import { getAuthIdentity } from "@posthog/core/auth/authIdentity";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuthStateValue } from "./store";

export const AUTH_SCOPED_QUERY_META = {
  authScoped: true,
} as const;

export const authKeys = {
  currentUsers: () => ["auth", "current-user"] as const,
  currentUser: (identity: string | null) =>
    [...authKeys.currentUsers(), identity ?? "anonymous"] as const,
};

export function useCurrentUser(options?: {
  enabled?: boolean;
  client?: PostHogAPIClient | null;
  refetchOnWindowFocus?: boolean | "always";
}) {
  const authState = useAuthStateValue((state) => state);
  const client = options?.client ?? null;
  const authIdentity = getAuthIdentity(authState);

  return useQuery({
    queryKey: authKeys.currentUser(authIdentity),
    queryFn: async () => {
      if (!client) {
        throw new Error("Not authenticated");
      }

      return await client.getCurrentUser();
    },
    enabled: !!client && !!authIdentity && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000,
    // The query key carries currentProjectId, so a project/org switch re-keys
    // to a fresh, dataless entry. Paint the last-confirmed user while the new
    // identity refetches instead of flashing the empty state. Gated on being
    // signed in so the placeholder dies with the session (logout → no stale
    // user). Anything org-specific on the user (e.g. membership_level) must
    // treat isPlaceholderData as unknown rather than trusting it.
    placeholderData: authIdentity ? keepPreviousData : undefined,
    refetchOnWindowFocus: options?.refetchOnWindowFocus,
    meta: AUTH_SCOPED_QUERY_META,
  });
}
