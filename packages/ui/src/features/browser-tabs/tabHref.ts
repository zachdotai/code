import type { PaneIdentity } from "@posthog/shared";
import { channelSectionFor } from "@posthog/ui/features/canvas/channelSections";

/**
 * A pane identity's canonical href — used to seed a pane router's initial
 * memory-history entry (boot restore, a merged tab's panes mounting, the
 * blank tab backfilled by closing the last tab), so restore and
 * click-navigation land on the same routes.
 */
export function hrefForIdentity(identity: PaneIdentity): string {
  if (identity.taskId && identity.channelId) {
    return `/website/${identity.channelId}/tasks/${identity.taskId}`;
  }
  if (identity.taskId) {
    return `/code/tasks/${identity.taskId}`;
  }
  if (identity.dashboardId && identity.channelId) {
    return `/website/${identity.channelId}/dashboards/${identity.dashboardId}`;
  }
  if (identity.channelId) {
    // Section keys are the route segments; unknown/stale sections (e.g. from
    // a since-removed tab type) fall back to the channel home.
    const section = channelSectionFor(identity.channelSection);
    return section
      ? `/website/${identity.channelId}/${section.key}`
      : `/website/${identity.channelId}`;
  }
  switch (identity.appView) {
    case "home":
      return "/code/home";
    case "inbox":
      return "/code/inbox";
    case "agents":
      return "/code/agents";
    case "skills":
      return "/skills";
    case "mcp-servers":
      return "/mcp-servers";
    case "command-center":
      return "/command-center";
    default:
      // Blank pane (or an unknown appView from a newer session): the Code
      // new-task screen. Boot never lands a blank pane on /website — its index
      // would redirect to channels[0] and hijack the blank.
      return "/code";
  }
}

/**
 * Where a freshly minted blank pane's router starts: the channels new-tab
 * page (/website renders BlankTabView for a blank pane) when channels are on,
 * else the Code new-task screen. Used by the strip's new-tab handler, which
 * pre-seeds the pane router so the new tab paints its landing immediately.
 */
export function defaultBlankPaneHref(channelsEnabled: boolean): string {
  return channelsEnabled ? "/website" : "/code";
}
