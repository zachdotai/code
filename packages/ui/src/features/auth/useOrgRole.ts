import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";

export const ORGANIZATION_ADMIN_LEVEL = 8;

export function useIsOrgAdmin(): { isAdmin: boolean | null } {
  const client = useOptionalAuthenticatedClient();
  const { data, isLoading, isPlaceholderData } = useCurrentUser({ client });
  const level = data?.organization?.membership_level ?? null;
  // membership_level is for the user's current org, so placeholder data carried
  // across an org switch is the wrong org's role. Treat it as unknown until the
  // new identity resolves.
  if (isLoading || isPlaceholderData || level === null)
    return { isAdmin: null };
  return { isAdmin: level >= ORGANIZATION_ADMIN_LEVEL };
}
