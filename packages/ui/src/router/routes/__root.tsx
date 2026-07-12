import { XIcon } from "@phosphor-icons/react";
import { useHostTRPC } from "@posthog/host-router/react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";
import {
  closePane as closePaneTransform,
  decidePaneNavigation,
  type PaneIdentity,
  paneIdentityOf,
  setFocusedPane,
  setPaneTarget,
  setWindowActiveTab,
} from "@posthog/shared";
import { isAppView } from "@posthog/ui/features/browser-tabs/appViews";
import { BlankTabView } from "@posthog/ui/features/browser-tabs/BlankTabView";
import { PaneDropZones } from "@posthog/ui/features/browser-tabs/panes/PaneDropZones";
import { usePaneDragStore } from "@posthog/ui/features/browser-tabs/panes/paneDragStore";
import { hrefForIdentity } from "@posthog/ui/features/browser-tabs/tabHref";
import {
  applyLocalTransform,
  persistWrite,
  readMirror,
} from "@posthog/ui/features/browser-tabs/tabsSync";
import { useTabsSnapshot } from "@posthog/ui/features/browser-tabs/useBrowserTabs";
import { channelSectionFor } from "@posthog/ui/features/canvas/channelSections";
import { getPaneHistoryTracker } from "@posthog/ui/router/createAppRouter";
import { useAppView } from "@posthog/ui/router/useAppView";
import { ContentHeader } from "@posthog/ui/shell/ContentHeader";
import { Box, Flex } from "@radix-ui/themes";
import { useMutation } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Outlet,
  useParams,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
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
 * The root of ONE pane's route tree: the shared content header and the routed
 * outlet, plus the effect that reconciles this pane's location back into the
 * tab snapshot. Window-level chrome (title bar with the tab strip, sidebar,
 * global modals, deep links) lives OUTSIDE the router in AppShell — each pane
 * of the active tab hosts its own router, and anything here mounts once per
 * pane.
 */
function PaneChrome() {
  const { paneId } = Route.useRouteContext();
  const router = useRouter();
  const trpc = useHostTRPC();
  const snapshot = useTabsSnapshot();
  const params = useParams({ strict: false }) as {
    channelId?: string;
    dashboardId?: string;
    taskId?: string;
  };
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const view = useAppView();
  const routeAppView = isAppView(view.type) ? view.type : null;

  // The active channel sub-section (artifacts/history/context) is the route
  // segment after the channelId. Null when on the channel home or a
  // non-section route (canvas/task), so a channel-home pane keys by name.
  const routeChannelSection = useMemo(() => {
    if (!params.channelId) return null;
    const seg = pathname.split("/")[3] ?? null;
    return channelSectionFor(seg)?.key ?? null;
  }, [pathname, params.channelId]);

  const setPaneTargetMutation = useMutation(
    trpc.browserTabs.setPaneTarget.mutationOptions(),
  );
  const setActiveTabMutation = useMutation(
    trpc.browserTabs.setActiveTab.mutationOptions(),
  );
  const setFocusedPaneMutation = useMutation(
    trpc.browserTabs.setFocusedPane.mutationOptions(),
  );
  const closePaneMutation = useMutation(
    trpc.browserTabs.closePane.mutationOptions(),
  );

  // Reconcile this pane's location into the snapshot on every location
  // change: an ordinary navigation points the pane at the route's identity
  // (setPaneTarget — the pane's location IS its content pointer), and a PUSH
  // to a page already open in another pane focuses that pane's tab instead of
  // duplicating it (decidePaneNavigation).
  //
  // Keyed on the LOCATION only — the route is the command stream; the mirror
  // is state this effect reconciles against, read fresh via readMirror()
  // rather than subscribed to. Running on mirror changes is actively wrong
  // under local-first sync (see tabsSync.ts).
  useEffect(() => {
    const mirror = readMirror();
    const pane = mirror.panes.find((p) => p.id === paneId);
    if (!pane) return;
    const routeIdentity: PaneIdentity = {
      dashboardId: params.dashboardId ?? null,
      taskId: params.taskId ?? null,
      channelId: params.channelId ?? null,
      channelSection: routeChannelSection,
      appView: routeAppView,
    };
    const decision = decidePaneNavigation({
      paneIdentity: paneIdentityOf(pane),
      routeIdentity,
      otherOpenPanes: mirror.panes
        .filter((p) => p.windowId === pane.windowId && p.id !== paneId)
        .map((p) => ({
          tabId: p.tabId,
          paneId: p.id,
          identity: paneIdentityOf(p),
        })),
      historyAction: getPaneHistoryTracker(router).lastAction(),
    });
    switch (decision.type) {
      case "replacePane": {
        const target = { paneId, ...routeIdentity };
        // Synchronous local apply keeps re-entrant runs (and the /website
        // index redirect guard) from ever seeing the pre-navigation target.
        applyLocalTransform((s) =>
          setPaneTarget(s, { ...target, now: Date.now }),
        );
        void persistWrite(() => setPaneTargetMutation.mutateAsync(target));
        break;
      }
      case "activateTab": {
        // The page already lives in another pane → focus its tab + pane, and
        // put THIS pane's history back on its own identity (the navigation
        // landed here before the dedup decision could).
        applyLocalTransform((s) =>
          setFocusedPane(
            setWindowActiveTab(s, pane.windowId, decision.tabId),
            decision.tabId,
            decision.paneId,
          ),
        );
        void persistWrite(() =>
          setActiveTabMutation.mutateAsync({
            windowId: pane.windowId,
            tabId: decision.tabId,
          }),
        );
        void persistWrite(() =>
          setFocusedPaneMutation.mutateAsync({
            tabId: decision.tabId,
            paneId: decision.paneId,
          }),
        );
        router.history.replace(hrefForIdentity(paneIdentityOf(pane)));
        break;
      }
      case "noop":
        break;
    }
  }, [
    paneId,
    params.channelId,
    params.dashboardId,
    params.taskId,
    routeChannelSection,
    routeAppView,
    router,
    setPaneTargetMutation.mutateAsync,
    setActiveTabMutation.mutateAsync,
    setFocusedPaneMutation.mutateAsync,
  ]);

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

  // A blank pane (a fresh "+" tab) shows an empty placeholder — but ONLY on
  // the channels index. Inside a channel (`/website/$channelId…`) the route
  // owns the content, so the placeholder must never replace it, otherwise
  // channel navigation looks dead.
  const onChannelsIndex = useRouterState({
    select: (s) => s.location.pathname === "/website",
  });
  const mirrorPane = snapshot.panes.find((p) => p.id === paneId);
  const paneIsBlankNow =
    !!mirrorPane &&
    mirrorPane.dashboardId == null &&
    mirrorPane.taskId == null &&
    mirrorPane.channelId == null &&
    mirrorPane.appView == null;
  const showBlankTab = onChannelsIndex && paneIsBlankNow;

  // This pane's owner tab. The hover close-X only exists on multi-pane tabs
  // (closing the last pane is closing the tab — the strip owns that), and the
  // merge drop zones are suppressed while the dragged pill IS this tab (a tab
  // can't merge into itself).
  const ownerTab = mirrorPane
    ? snapshot.tabs.find((t) => t.id === mirrorPane.tabId)
    : undefined;
  const isMultiPane = ownerTab?.layout.type === "split";
  const drag = usePaneDragStore((s) => s.drag);
  const zonesActive = !!drag && !!ownerTab && drag.tabId !== ownerTab.id;

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
      {/* The /website space renders its own header (WebsiteLayout); everywhere
          else the shared header carries the view title and, on a task, its
          action row. */}
      {!onWebsitePath && <ContentHeader />}
      <Box flexGrow="1" overflow="hidden" className="relative">
        {showBlankTab ? <BlankTabView /> : <Outlet />}
        {/* Merge drop zones over the CONTENT slot only. */}
        {zonesActive ? <PaneDropZones paneId={paneId} /> : null}
        {/* Hover close-X: removes this pane from its (multi-pane) tab. Rides
            the pane wrapper's `group` hover (BrowserPane). */}
        {isMultiPane && ownerTab ? (
          <ClosePaneButton
            tabId={ownerTab.id}
            paneId={paneId}
            onClose={(input) => {
              void persistWrite(() => closePaneMutation.mutateAsync(input));
            }}
          />
        ) : null}
      </Box>
    </Flex>
  );
}

function ClosePaneButton({
  tabId,
  paneId,
  onClose,
}: {
  tabId: string;
  paneId: string;
  onClose: (input: { tabId: string; paneId: string }) => void;
}) {
  const handleClick = () => {
    applyLocalTransform((s) => closePaneTransform(s, tabId, paneId));
    onClose({ tabId, paneId });
  };
  return (
    <TooltipProvider delay={400}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Close pane"
              onClick={handleClick}
              className="absolute top-1.5 right-1.5 z-90 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <XIcon size={12} />
            </Button>
          }
        />
        <TooltipContent side="bottom">Close pane</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
