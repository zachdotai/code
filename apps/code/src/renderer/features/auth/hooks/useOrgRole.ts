import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useCurrentUser } from "@features/auth/hooks/authQueries";

export const ORGANIZATION_ADMIN_LEVEL = 8;

export function useIsOrgAdmin(): { isAdmin: boolean | null } {
  const client = useOptionalAuthenticatedClient();
  const { data, isLoading } = useCurrentUser({ client });
  const level = data?.organization?.membership_level ?? null;
  if (isLoading || level === null) return { isAdmin: null };
  return { isAdmin: level >= ORGANIZATION_ADMIN_LEVEL };
}

// !!! IMPORTANT !!!
// REMOVE THIS ALLOWLIST BEFORE SQUASHING / MERGING THIS COMMIT.
// These are temporary demo entries and must not land in the squashed history.
// !!!!!!!!!!!!!!!!!!
//
// Demo accounts (Brooker-Fam / nexus-games) allowed to see the raw FinOps
// dialog alongside PostHog org members. Raw API cost figures here are not the
// consumer product price, so this is an explicit demo allowlist.
const INTERNAL_DEMO_EMAILS = new Set<string>([
  "seanosh@gmail.com",
  "mattbrook3r+games@gmail.com",
]);

export function useCanViewFinOps(): boolean | null {
  const client = useOptionalAuthenticatedClient();
  const { data, isLoading } = useCurrentUser({ client });
  if (isLoading || !data) return null;
  const email = data.email.toLowerCase();
  return email.endsWith("@posthog.com") || INTERNAL_DEMO_EMAILS.has(email);
}
