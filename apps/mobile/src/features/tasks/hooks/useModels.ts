import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuthStore } from "@/features/auth";
import { getAvailableModels } from "../api";
import type { ModelOption } from "../composer/options";
import { useModelStore } from "../stores/modelStore";

export const modelKeys = {
  all: ["models"] as const,
  list: () => [...modelKeys.all, "list"] as const,
};

function modelsEqual(a: ModelOption[], b: ModelOption[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].value !== b[i].value ||
      a[i].label !== b[i].label ||
      a[i].description !== b[i].description ||
      a[i].supportsReasoning !== b[i].supportsReasoning
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Downloads the available model list from the LLM gateway (the same source the
 * desktop app uses) and mirrors it into a persisted cache. Returns the live
 * list once it lands, falling back to the cached snapshot so the picker always
 * has something to render.
 */
export function useModels() {
  const oauthAccessToken = useAuthStore((s) => s.oauthAccessToken);
  const cloudRegion = useAuthStore((s) => s.cloudRegion);
  const cachedModels = useModelStore((s) => s.models);
  const setModels = useModelStore((s) => s.setModels);

  const query = useQuery({
    queryKey: modelKeys.list(),
    queryFn: getAvailableModels,
    enabled: !!oauthAccessToken && !!cloudRegion,
    staleTime: 10 * 60 * 1000,
  });

  // Mirror the latest non-empty fetch into the persisted cache. Skip empty
  // results (gateway unreachable) so a transient failure can't wipe a working
  // snapshot, and skip no-op writes so we don't churn store subscribers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setModels is a stable Zustand action
  useEffect(() => {
    const live = query.data;
    if (!live || live.length === 0) return;
    if (modelsEqual(live, cachedModels)) return;
    setModels(live);
  }, [query.data, cachedModels]);

  // Prefer live data once it's in; fall back to the persisted snapshot.
  const models =
    query.data && query.data.length > 0 ? query.data : cachedModels;

  return {
    models,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
