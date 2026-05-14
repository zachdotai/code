import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import { orgMembersQueryKey } from "@features/auth/hooks/useOrgMembers";
import type { OrgMember } from "@renderer/api/posthogClient";
import { queryClient } from "@utils/queryClient";
import type { SuggestionItem } from "../types";
import { createSuggestionMention } from "./createSuggestionMention";

interface TeamMemberSuggestionItem extends SuggestionItem {
  email: string;
}

function memberDisplayName(member: OrgMember): string {
  const full = `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim();
  return full || member.email;
}

function memberMatchesQuery(member: OrgMember, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    memberDisplayName(member).toLowerCase().includes(q) ||
    member.email.toLowerCase().includes(q)
  );
}

async function loadOrgMembers(): Promise<OrgMember[]> {
  return queryClient.fetchQuery({
    queryKey: orgMembersQueryKey,
    queryFn: async () => {
      const client = await getAuthenticatedClient();
      if (!client) return [];
      return client.getOrgMembers();
    },
    staleTime: 5 * 60_000,
  });
}

export function createTeamMemberMention() {
  return createSuggestionMention<TeamMemberSuggestionItem>({
    name: "teamMemberMention",
    char: "@",
    chipType: "team_member",
    items: async (query) => {
      const members = await loadOrgMembers();
      const filtered = members.filter((m) => memberMatchesQuery(m, query));
      return filtered.slice(0, 8).map((m) => ({
        id: m.uuid,
        label: memberDisplayName(m),
        description: m.email,
        email: m.email,
        chipType: "team_member",
      }));
    },
  });
}
