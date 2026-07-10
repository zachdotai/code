import { BlankTabView } from "@posthog/ui/features/browser-tabs/BlankTabView";
import { BrowserTabStrip } from "@posthog/ui/features/browser-tabs/BrowserTabStrip";
import { PaneDropZones } from "@posthog/ui/features/browser-tabs/panes/PaneDropZones";
import { usePaneActiveTabIsBlank } from "@posthog/ui/features/browser-tabs/useBrowserTabs";
import { ContentHeader } from "@posthog/ui/shell/ContentHeader";
import { Box, Flex } from "@radix-ui/themes";
import {
  createRootRouteWithContext,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { createPortal } from "react-dom";

// The router devtools render their genuine floating overlay, mounted by the
// app's dev toolbar with the floating logo hidden so the toolbar owns the
// trigger — see RouterDevtools.

/** Per-pane router context, supplied by createAppRouter. */
interface PaneRouterContext {
  paneId: string;
}

export const Route = createRootRouteWithContext<PaneRouterContext>()({
  component: PaneChrome,
});

/**
 * The root of ONE pane's route tree: its tab strip, the shared content header,
 * and the routed outlet. Window-level chrome (title bar, sidebar, global
 * modals, deep links) lives OUTSIDE the router in AppShell — with split panes
 * each pane hosts its own router, and anything here mounts once per pane.
 */
function PaneChrome() {
  const { paneId } = Route.useRouteContext();
  // Settings is a full-window surface: it stays a route inside the pane's
  // history (so closeSettings()'s history.back() exits it exactly as before),
  // but renders through a portal covering the whole window — panes and chrome
  // stay mounted (terminals keep running) underneath.
  const isSettingsRoute = useRouterState({
    select: (s) => s.matches.some((m) => m.routeId.startsWith("/settings")),
  });

  // The /website (Channels) routes own their own in-pane header
  // (WebsiteLayout), so the shared ContentHeader is mounted only outside that
  // space.
  const onWebsitePath = useRouterState({
    select: (s) =>
      s.location.pathname === "/website" ||
      s.location.pathname.startsWith("/website/"),
  });

  // A blank browser tab (the "+" new-tab page) shows an empty placeholder — but
  // ONLY on the channels index. Inside a channel (`/website/$channelId…`) the
  // route owns the content (channel home, inbox, artifacts, a canvas, …), so the
  // placeholder must never replace it, otherwise channel navigation looks dead.
  const onChannelsIndex = useRouterState({
    select: (s) => s.location.pathname === "/website",
  });
  const activeTabBlank = usePaneActiveTabIsBlank(paneId);
  const showBlankTab = onChannelsIndex && activeTabBlank;

  if (isSettingsRoute) {
    return createPortal(
      <Flex
        direction="column"
        className="fixed inset-0 z-50 bg-background"
        data-testid="settings-overlay"
      >
        <Outlet />
      </Flex>,
      document.body,
    );
  }

  return (
    <Flex direction="column" height="100%">
      {/* The pane's tab strip. Tabs work in both spaces: channel tabs under
          /website and plain task tabs in the Code experience. The strip's
          route→tab effect noops on param-less routes (inbox, agents,
          new-task), so it's safe to mount everywhere. */}
      <Flex align="center" className="h-10 shrink-0 border-border border-b">
        <BrowserTabStrip paneId={paneId} />
      </Flex>
      {/* The /website space renders its own header (WebsiteLayout); everywhere
          else the shared header carries the view title and, on a task, its
          action row. */}
      {!onWebsitePath && <ContentHeader />}
      <Box flexGrow="1" overflow="hidden" className="relative">
        {showBlankTab ? <BlankTabView /> : <Outlet />}
        {/* Split/move drop zones over the CONTENT slot only — overlaying the
            strip row would swallow drops aimed at its pills/bar. */}
        <PaneDropZones paneId={paneId} />
      </Box>
    </Flex>
  );
}
