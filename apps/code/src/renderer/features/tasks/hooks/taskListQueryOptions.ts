/**
 * Shared options for the three task-list queries (tasks, summaries,
 * slack tasks). Force a refetch on return-to-focus regardless of
 * staleness — the global `staleTime` is 5 min, so
 * `refetchOnWindowFocus: true` would silently skip the refetch in the
 * exact window we care about (laptop opened after a short walk).
 */
export const TASK_LIST_QUERY_OPTIONS = {
  refetchOnWindowFocus: "always" as const,
};
