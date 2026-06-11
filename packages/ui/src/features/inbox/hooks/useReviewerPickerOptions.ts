import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import {
  buildSuggestedReviewerFilterOptions,
  type SuggestedReviewerFilterOption,
} from "@posthog/ui/features/inbox/filterOptions";
import { useInboxAvailableSuggestedReviewers } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { useMemo } from "react";

interface UseReviewerPickerOptionsParams {
  /**
   * Server-side search term. An empty string fetches the full base list; any
   * other value is forwarded to the `available_reviewers` endpoint, which does
   * the matching server-side.
   */
  query?: string;
  /**
   * Gate the underlying fetch. Pass the picker's open state so the list
   * re-fetches every time it is opened (the query mounts fresh, and
   * `refetchOnMount: "always"` then pulls the latest people).
   */
  enabled?: boolean;
}

export interface ReviewerPickerOptions {
  options: SuggestedReviewerFilterOption[];
  isFetching: boolean;
  hasResults: boolean;
}

/**
 * Shared data source for the people pickers (suggested reviewers + inbox scope
 * teammate selector). Centralises server-side search and the "pin me to the
 * top" behaviour so both surfaces stay consistent.
 */
export function useReviewerPickerOptions(
  params?: UseReviewerPickerOptionsParams,
): ReviewerPickerOptions {
  const client = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({ client });
  const query = params?.query?.trim() ?? "";
  const isSearching = query.length > 0;

  const { data, isFetching } = useInboxAvailableSuggestedReviewers({
    query,
    enabled: params?.enabled,
  });

  const options = useMemo(
    () =>
      buildSuggestedReviewerFilterOptions(
        data?.results ?? [],
        // Only pin the current user onto the unfiltered base list. While the
        // user is searching the server already decides who matches, so forcing
        // "me" in would surface the current user for unrelated queries.
        isSearching || !currentUser
          ? null
          : {
              uuid: currentUser.uuid,
              email: currentUser.email,
              first_name: currentUser.first_name,
              last_name: currentUser.last_name,
            },
      ),
    [data?.results, currentUser, isSearching],
  );

  return {
    options,
    isFetching,
    hasResults: !!data?.results?.length,
  };
}
