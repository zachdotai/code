import { isApmEnrichmentEligible } from "@posthog/core/code-editor/apmEnrichmentEligibility";
import { useHostTRPC } from "@posthog/host-router/react";
import type { SerializedApmEnrichment } from "@posthog/shared";
import { APM_ENRICHMENT_FLAG } from "@posthog/shared/constants";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useQuery } from "@tanstack/react-query";
import { useAuthStateValue } from "../../auth/store";

interface UseFileApmEnrichmentOptions {
  /**
   * Repo-relative path of the open file. The server suffix-matches it against
   * the recorded OTel `code.file.path` (which may carry an extra crate/workspace
   * prefix), so `src/flags/flag_matching.rs` matches a recorded
   * `feature-flags/src/flags/flag_matching.rs`.
   */
  filePath: string;
}

export function useFileApmEnrichment({
  filePath,
}: UseFileApmEnrichmentOptions): SerializedApmEnrichment | null | undefined {
  const trpc = useHostTRPC();
  const isAuthenticated = useAuthStateValue(
    (s) => s.status === "authenticated",
  );
  // Gated behind a PostHog flag for safe rollout; on automatically in dev.
  const flagEnabled =
    useFeatureFlag(APM_ENRICHMENT_FLAG) || import.meta.env.DEV;

  // Eligibility by file type; not gated on `isInsideRepo` since spans match by
  // path suffix regardless of the task's repo root.
  const eligible = isApmEnrichmentEligible(filePath);
  const enabled = flagEnabled && eligible && isAuthenticated;

  const query = useQuery(
    trpc.apmEnrichment.enrichFile.queryOptions(
      { filePath },
      {
        enabled,
        // APM data is cheap to refresh; a bounded stale time lets React Query
        // silently background-refresh so latency numbers don't go stale after a
        // deploy, without causing visible loading flickers.
        staleTime: 5 * 60 * 1000,
      },
    ),
  );

  // `undefined` when the query can't run (flag off, ineligible file, or signed
  // out) so the editor skips the gutter extension entirely; `null` means
  // "active, no data yet".
  return enabled ? (query.data ?? null) : undefined;
}
