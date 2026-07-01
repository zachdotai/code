import {
  INBOX_ROOT_ROUTE,
  INBOX_TAB_DETAIL_ROUTE_BY_SPACE,
  INBOX_TAB_LIST_ROUTE_BY_SPACE,
  type InboxSpace,
  inboxSpaceFromPath,
} from "@posthog/core/inbox/reportMembership";
import { useRouterState } from "@tanstack/react-router";

/**
 * The navigation space the inbox is currently rendered in — `code` under
 * `/code/inbox/*`, `website` under `/website/inbox/*`. Inbox view components are
 * shared across both subtrees, so they read this to resolve their tabs, cards,
 * back-links, and redirects to routes that keep the user in their space.
 */
export function useInboxSpace(): InboxSpace {
  return useRouterState({
    select: (s) => inboxSpaceFromPath(s.location.pathname),
  });
}

/** Space-resolved inbox route maps for the current space. */
export function useInboxRoutes() {
  const space = useInboxSpace();
  return {
    space,
    root: INBOX_ROOT_ROUTE[space],
    list: INBOX_TAB_LIST_ROUTE_BY_SPACE[space],
    detail: INBOX_TAB_DETAIL_ROUTE_BY_SPACE[space],
  };
}
