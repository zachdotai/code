import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import type { OrgMember } from "@renderer/api/posthogClient";

const ORG_MEMBERS_KEY = ["org-members"] as const;

export function useOrgMembers() {
  return useAuthenticatedQuery<OrgMember[]>(
    ORG_MEMBERS_KEY,
    (client) => client.getOrgMembers(),
    {
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  );
}

export const orgMembersQueryKey = ORG_MEMBERS_KEY;
