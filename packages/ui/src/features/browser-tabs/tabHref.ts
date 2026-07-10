import { channelSectionFor } from "@posthog/ui/features/canvas/channelSections";

/** The identity fields that map a tab to its canonical route. */
export type TabHrefInput = {
  dashboardId: string | null;
  taskId: string | null;
  channelId: string | null;
  channelSection: string | null;
  appView: string | null;
};

/**
 * A tab identity's canonical href — used to seed a pane router's initial
 * memory-history entry at boot, so restore and click-navigation land on the
 * same routes.
 *
 * KEEP IN SYNC with `goToTab` in BrowserTabStrip.tsx: that function performs
 * the same mapping through the typed `navigate({ to, params })` API (which
 * this string-building helper cannot use). The colocated test cross-checks
 * the two on every identity shape.
 */
export function hrefForTab(tab: TabHrefInput): string {
  if (tab.taskId && tab.channelId) {
    return `/website/${tab.channelId}/tasks/${tab.taskId}`;
  }
  if (tab.taskId) {
    return `/code/tasks/${tab.taskId}`;
  }
  if (tab.dashboardId && tab.channelId) {
    return `/website/${tab.channelId}/dashboards/${tab.dashboardId}`;
  }
  if (tab.channelId) {
    // Section keys are the route segments; unknown/stale sections (e.g. from
    // a since-removed tab type) fall back to the channel home.
    const section = channelSectionFor(tab.channelSection);
    return section
      ? `/website/${tab.channelId}/${section.key}`
      : `/website/${tab.channelId}`;
  }
  switch (tab.appView) {
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
      // Blank tab (or an unknown appView from a newer session): the Code
      // new-task screen. Boot never lands a blank tab on /website — its index
      // would redirect to channels[0] and hijack the blank.
      return "/code";
  }
}
