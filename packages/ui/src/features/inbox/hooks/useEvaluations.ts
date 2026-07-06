import type { Evaluation } from "@posthog/api-client/posthog-client";
import { useAuthenticatedQuery } from "../../../hooks/useAuthenticatedQuery";
import { useAuthStateValue } from "../../auth/store";

// Slow safety-net refresh — evaluation changes are infrequent and the inbox's
// primary freshness now comes from the local-first sync engine.
const POLL_INTERVAL_MS = 30_000;

export function useEvaluations() {
  const projectId = useAuthStateValue((s) => s.currentProjectId);
  return useAuthenticatedQuery<Evaluation[]>(
    ["evaluations", projectId],
    (client) =>
      projectId ? client.listEvaluations(projectId) : Promise.resolve([]),
    {
      enabled: !!projectId,
      staleTime: POLL_INTERVAL_MS,
      refetchInterval: POLL_INTERVAL_MS,
    },
  );
}
