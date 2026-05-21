import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useCurrentUser } from "@features/auth/hooks/authQueries";
import { useFeatureFlag } from "@hooks/useFeatureFlag";
import { RTS_FINOPS_FLAG } from "@shared/constants";

export const ORGANIZATION_ADMIN_LEVEL = 8;

export function useIsOrgAdmin(): { isAdmin: boolean | null } {
  const client = useOptionalAuthenticatedClient();
  const { data, isLoading } = useCurrentUser({ client });
  const level = data?.organization?.membership_level ?? null;
  if (isLoading || level === null) return { isAdmin: null };
  return { isAdmin: level >= ORGANIZATION_ADMIN_LEVEL };
}

export function useCanViewFinOps(): boolean | null {
  const client = useOptionalAuthenticatedClient();
  const { data, isLoading } = useCurrentUser({ client });
  const flagEnabled = useFeatureFlag(RTS_FINOPS_FLAG, import.meta.env.DEV);
  if (isLoading || !data) return null;
  if (!flagEnabled) return false;
  return data.email.toLowerCase().endsWith("@posthog.com");
}
