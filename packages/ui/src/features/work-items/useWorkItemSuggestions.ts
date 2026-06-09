import type { PrWorkItem } from "@posthog/core/git/router-schemas";
import { useHostTRPC } from "@posthog/host-router/react";
import { WORK_ITEM_SUGGESTIONS_FLAG } from "@posthog/shared/constants";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useQuery } from "@tanstack/react-query";

export function useWorkItemSuggestions(
  selectedDirectory: string | null | undefined,
): PrWorkItem[] {
  const trpc = useHostTRPC();
  const flagEnabled = useFeatureFlag(
    WORK_ITEM_SUGGESTIONS_FLAG,
    import.meta.env.DEV,
  );

  const { data } = useQuery({
    ...trpc.git.getPrWorkItems.queryOptions({
      directoryPath: selectedDirectory ?? "",
    }),
    enabled: flagEnabled && !!selectedDirectory,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  return data ?? [];
}
