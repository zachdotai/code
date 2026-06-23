import type { AgentApplication } from "@posthog/shared/agent-platform-types";
import { useAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStateValue } from "../../auth/store";
import { agentApplicationsKeys } from "./agentApplicationsKeys";

/**
 * Patch mutable application-level fields (name, description). Invalidates the
 * detail + list caches so the agent header, list row, and overview summary
 * re-render with the new value.
 */
export function useUpdateAgentApplication(idOrSlug: string) {
  const client = useAuthenticatedClient();
  const queryClient = useQueryClient();
  const projectId = useAuthStateValue((state) => state.currentProjectId);

  return useMutation<
    AgentApplication,
    Error,
    { name?: string; description?: string }
  >({
    mutationFn: (patch) => client.updateAgentApplication(idOrSlug, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: agentApplicationsKeys.detail(projectId, idOrSlug),
      });
      void queryClient.invalidateQueries({
        queryKey: agentApplicationsKeys.list(projectId),
      });
    },
  });
}
