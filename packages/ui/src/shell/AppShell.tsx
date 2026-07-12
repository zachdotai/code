import {
  ArrowSquareOut,
  CaretLeftIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";
import { useHostTRPC, useHostTRPCClient } from "@posthog/host-router/react";
import { Button, ButtonGroup } from "@posthog/quill";
import {
  BILLING_FLAG,
  HOME_TAB_FLAG,
  PROJECT_BLUEBIRD_FLAG,
  SYNC_CLOUD_TASKS_FLAG,
} from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { isContentlessTask } from "@posthog/shared/domain-types";
import { DeepLinkApprovalModal } from "@posthog/ui/features/agent-applications/components/DeepLinkApprovalModal";
import { useApprovalDeepLink } from "@posthog/ui/features/agent-applications/hooks/useApprovalDeepLink";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { UsageButton } from "@posthog/ui/features/billing/UsageButton";
import { UsageLimitModal } from "@posthog/ui/features/billing/UsageLimitModal";
import { BrowserTabStrip } from "@posthog/ui/features/browser-tabs/BrowserTabStrip";
import { BrowserTabsDndProvider } from "@posthog/ui/features/browser-tabs/BrowserTabsDnd";
import { ChannelsSidebar } from "@posthog/ui/features/canvas/components/ChannelsSidebar";
import { useChannelsSidebarStore } from "@posthog/ui/features/canvas/components/channelsSidebarStore";
import {
  FeedbackModal,
  type FeedbackModalMode,
} from "@posthog/ui/features/canvas/components/FeedbackModal";
import { useCanvasDeepLink } from "@posthog/ui/features/canvas/hooks/useCanvasDeepLink";
import { useChannelDeepLink } from "@posthog/ui/features/canvas/hooks/useChannelDeepLink";
import { CommandMenu } from "@posthog/ui/features/command/CommandMenu";
import { GlobalFilePicker } from "@posthog/ui/features/command/GlobalFilePicker";
import { KeyboardShortcutsSheet } from "@posthog/ui/features/command/KeyboardShortcutsSheet";
import { ConnectivityBanner } from "@posthog/ui/features/connectivity/ConnectivityBanner";
import { useNewTaskDeepLink } from "@posthog/ui/features/deep-links/useNewTaskDeepLink";
import { useOpenTargetDeepLink } from "@posthog/ui/features/deep-links/useOpenTargetDeepLink";
import { useTaskDeepLink } from "@posthog/ui/features/deep-links/useTaskDeepLink";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useInboxDeepLink } from "@posthog/ui/features/inbox/hooks/useInboxDeepLink";
import { useIntegrations } from "@posthog/ui/features/integrations/useIntegrations";
import { useScoutDeepLink } from "@posthog/ui/features/scouts/hooks/useScoutDeepLink";
import { useSetupDiscovery } from "@posthog/ui/features/setup/useSetupDiscovery";
import {
  beginSidebarPeek,
  cancelSidebarPeek,
  endSidebarPeek,
  useSidebarPeekStore,
} from "@posthog/ui/features/sidebar/sidebarPeekStore";
import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { useSidebarData } from "@posthog/ui/features/sidebar/useSidebarData";
import { useVisualTaskOrder } from "@posthog/ui/features/sidebar/useVisualTaskOrder";
import { ExistingWorktreeDialog } from "@posthog/ui/features/task-detail/components/ExistingWorktreeDialog";
import { RemoteBranchCheckoutDialog } from "@posthog/ui/features/task-detail/components/RemoteBranchCheckoutDialog";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { TourOverlay } from "@posthog/ui/features/tour/components/TourOverlay";
import { UpdateAvailableModal } from "@posthog/ui/features/updates/UpdateAvailableModal";
import { WhatsNewModal } from "@posthog/ui/features/updates/WhatsNewModal";
import { useWorkspaces } from "@posthog/ui/features/workspace/useWorkspace";
import LogosLandscape from "@posthog/ui/primitives/Logo";
import type { AppRouter } from "@posthog/ui/router/paneRouterRegistry";
import { useAppView } from "@posthog/ui/router/useAppView";
import { openTask, openTaskInput } from "@posthog/ui/router/useOpenTask";
import { usePaneHistoryControls } from "@posthog/ui/router/usePaneHistoryControls";
import { track } from "@posthog/ui/shell/analytics";
import { useCommandMenuStore } from "@posthog/ui/shell/commandMenuStore";
import { GlobalEventHandlers } from "@posthog/ui/shell/GlobalEventHandlers";
import { HedgehogMode } from "@posthog/ui/shell/HedgehogMode";
import { logger } from "@posthog/ui/shell/logger";
import { onFeatureFlagsLoaded } from "@posthog/ui/shell/posthogAnalyticsImpl";
import { SpaceSwitcher } from "@posthog/ui/shell/SpaceSwitcher";
import { useShortcutsSheetStore } from "@posthog/ui/shell/shortcutsSheetStore";
import { openUrlInBrowser } from "@posthog/ui/utils/browser";
import { isWindows } from "@posthog/ui/utils/platform";
import { getPostHogUrl } from "@posthog/ui/utils/urls";
import { Box, Flex } from "@radix-ui/themes";
import { useQueryClient } from "@tanstack/react-query";
import { RouterContextProvider, useRouterState } from "@tanstack/react-router";
import { SidebarClose, SidebarOpen } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

const log = logger.scope("app-shell");

// On Windows the frameless window overlays the min/max/close controls on the
// top-right of the title bar (see window.ts titleBarOverlay). Reserve that strip
// so the tab strip / PostHog Web button never render under the native controls.
const WINDOWS_TITLEBAR_INSET = 140;

/**
 * The window chrome, rendered OUTSIDE the route tree: title bar (logo,
 * back/forward, the browser-tab strip, PostHog Web), connectivity banner,
 * channels sidebar, global modals/menus, deep-link handlers, and every
 * window-level side effect that must run exactly once. `children` is the
 * routed content (the active tab's pane tree — a RouterProvider per pane),
 * mounted in the inset content card.
 *
 * The whole shell sits inside a `RouterContextProvider` bound to the FOCUSED
 * pane's router (the active tab's focused pane), so every existing router
 * hook in the sidebar and title bar (useAppView, useRouterState, useCanGoBack,
 * Link) reads the focused pane and retargets automatically when focus moves —
 * chrome gets focused-pane semantics without rewriting its hooks.
 */
export function AppShell({
  router,
  children,
}: {
  router: AppRouter;
  children: ReactNode;
}) {
  return (
    <RouterContextProvider router={router}>
      <AppShellChrome>{children}</AppShellChrome>
    </RouterContextProvider>
  );
}

function AppShellChrome({ children }: { children: ReactNode }) {
  const view = useAppView();
  // Back/forward for the focused pane's history (the router in context).
  const {
    canGoBack,
    canGoForward,
    back: goBack,
    forward: goForward,
  } = usePaneHistoryControls();
  // Width of the Channels sidebar below — used to right-align the back/forward
  // buttons in the title bar with the sidebar's (and project switcher's) right edge.
  const channelsSidebarWidth = useChannelsSidebarStore((state) => state.width);
  // Suppress the title-bar width transition during a live drag so it tracks
  // the sidebar frame-for-frame; when the sidebar toggles open/closed, both
  // animate with the same curve (see ResizableSidebar).
  const sidebarIsResizing = useChannelsSidebarStore(
    (state) => state.isResizing,
  );

  // Feedback modal shown as an intercept before "PostHog Web" opens the web
  // app, routing once the modal is submitted or skipped.
  const [feedbackMode, setFeedbackMode] = useState<FeedbackModalMode | null>(
    null,
  );
  const currentProjectId = useAuthStateValue((s) => s.currentProjectId);

  // The user's current project on the correct cloud (region comes from
  // cloudRegion via getPostHogUrl), falling back to the account root. `null`
  // when the region is unknown — the "PostHog Web" button is disabled then, so
  // a click can never silently no-op.
  const posthogWebUrl = getPostHogUrl(
    currentProjectId ? `/project/${currentProjectId}` : "/",
  );

  // "PostHog Web" opens the feedback modal first and performs its navigation
  // only once the modal is submitted or skipped.
  const handleFeedbackFinished = () => {
    const finishedMode = feedbackMode;
    setFeedbackMode(null);
    if (finishedMode === "posthog-web" && posthogWebUrl) {
      void openUrlInBrowser(posthogWebUrl);
    }
  };

  const handleOpenPostHogWeb = () => {
    track(ANALYTICS_EVENTS.POSTHOG_WEB_OPENED);
    setFeedbackMode("posthog-web");
  };
  const {
    isOpen: commandMenuOpen,
    setOpen: setCommandMenuOpen,
    toggle: toggleCommandMenu,
  } = useCommandMenuStore();
  const {
    isOpen: shortcutsSheetOpen,
    close: closeShortcutsSheet,
    toggle: toggleShortcutsSheet,
  } = useShortcutsSheetStore();
  const { data: tasks } = useTasks();
  const { data: workspaces, isFetched: workspacesFetched } = useWorkspaces();
  const trpc = useHostTRPC();
  const hostClient = useHostTRPCClient();
  const queryClient = useQueryClient();
  const reconcilingTaskIds = useRef<Set<string>>(new Set());
  const billingEnabled = useFeatureFlag(BILLING_FLAG);
  const syncCloudTasksEnabled = useFeatureFlag(SYNC_CLOUD_TASKS_FLAG);
  const homeTabEnabled = useFeatureFlag(HOME_TAB_FLAG);
  // "PostHog Web" is a channels-world affordance — show it only while the user
  // is actually seeing channels (toggle on, which itself requires the flag).
  const bluebirdEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );
  const channelsToggleOn = useSidebarStore((s) => s.channelsEnabled);
  const channelsEnabled = channelsToggleOn && bluebirdEnabled;
  // When the sidebar is collapsed (Cmd+B) the title bar's left block shrinks to
  // fit its own controls so the tab strip flushes left with the content pane.
  const sidebarOpen = useSidebarStore((s) => s.open);
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const sidebarPeek = useSidebarPeekStore((s) => s.peek);
  // Toggling makes any hover-peek redundant (opening replaces the overlay;
  // closing must not leave it lingering under the pointer).
  const handleToggleSidebar = (): void => {
    cancelSidebarPeek();
    toggleSidebar();
  };

  const sidebarData = useSidebarData({ activeView: view });
  const visualTaskOrder = useVisualTaskOrder(sidebarData);
  const activeTaskId =
    view.type === "task-detail" && view.taskId ? view.taskId : null;

  useIntegrations();
  useTaskDeepLink();
  useOpenTargetDeepLink();
  useInboxDeepLink();
  useScoutDeepLink();
  useCanvasDeepLink();
  useChannelDeepLink();
  const approvalDeepLink = useApprovalDeepLink();
  useSetupDiscovery();
  useNewTaskDeepLink();

  useEffect(() => {
    if (!syncCloudTasksEnabled) return;
    if (!tasks || !workspaces || !workspacesFetched) return;
    const missing = tasks.filter(
      (t) =>
        t.latest_run?.environment === "cloud" &&
        !workspaces[t.id] &&
        !reconcilingTaskIds.current.has(t.id) &&
        !isContentlessTask(t),
    );
    if (missing.length === 0) return;
    const missingIds = missing.map((t) => t.id);
    for (const id of missingIds) reconcilingTaskIds.current.add(id);
    // Single batched IPC instead of one mutation per task — with many cloud
    // tasks the per-task pattern saturates the main thread at boot.
    hostClient.workspace.reconcileCloudWorkspaces
      .mutate({ taskIds: missingIds })
      .then((result) => {
        for (const id of missingIds) reconcilingTaskIds.current.delete(id);
        if (result.created.length > 0) {
          void queryClient.invalidateQueries({
            queryKey: trpc.workspace.getAll.queryKey(),
          });
        }
      })
      .catch((err) => {
        for (const id of missingIds) reconcilingTaskIds.current.delete(id);
        log.warn("Failed to reconcile cloud workspaces", err);
      });
  }, [
    syncCloudTasksEnabled,
    tasks,
    workspaces,
    workspacesFetched,
    queryClient,
    hostClient,
    trpc,
  ]);

  // The /code/home route is only reachable while the home-tab flag is on, but
  // flags resolve asynchronously – a restored route (or a flag flipping off
  // mid-session) can leave us on home without access. Redirect to the new-task
  // screen once flags have loaded and home is gated off.
  const [flagsLoaded, setFlagsLoaded] = useState(false);
  useEffect(() => onFeatureFlagsLoaded(() => setFlagsLoaded(true)), []);
  useEffect(() => {
    if (flagsLoaded && !homeTabEnabled && view.type === "home") {
      openTaskInput();
    }
  }, [flagsLoaded, homeTabEnabled, view.type]);

  const onWebsitePath = useRouterState({
    select: (s) =>
      s.location.pathname === "/website" ||
      s.location.pathname.startsWith("/website/"),
  });

  // The /website (Channels) routes stay registered regardless of the flag, so a
  // stale URL, a restored session, or a persisted channel browser tab could
  // strand a flag-off user on the channel layout with no way back (the Channels
  // toggle is hidden and ContentHeader is suppressed on /website). Once flags
  // resolve, send them back to Code.
  useEffect(() => {
    if (flagsLoaded && !bluebirdEnabled && onWebsitePath) {
      openTaskInput();
    }
  }, [flagsLoaded, bluebirdEnabled, onWebsitePath]);

  return (
    // DnD scope for the tab strip's drag-to-reorder and the merge drop zones —
    // the provider must span the title-bar pills and every pane.
    <BrowserTabsDndProvider>
      <Flex direction="column" height="100%" className="bg-chrome">
        {/* Full-width title bar: a window-drag region carrying the PostHog
            mark. The left section matches the sidebar width so the tab strip
            starts flush with the content pane; its padding clears the macOS
            stoplights. */}
        <Flex
          align="center"
          className="drag h-10 shrink-0"
          style={{
            paddingRight: isWindows ? WINDOWS_TITLEBAR_INSET : undefined,
          }}
        >
          <Flex
            id="title-bar-left"
            align="center"
            justify="between"
            gap="3"
            className="shrink-0 pr-2 pl-[78px]"
            style={{
              width: sidebarOpen ? channelsSidebarWidth : undefined,
              // Same curve/duration as ResizableSidebar's SLIDE_EASING so the
              // title bar tracks the sidebar edge.
              transition: sidebarIsResizing
                ? "none"
                : "width 0.2s cubic-bezier(0, 0, 0.2, 1)",
            }}
          >
            <Flex align="center" gap="2" className="no-drag">
              <Box className="h-[14px] w-[30px] overflow-hidden [&>svg]:h-[14px] [&>svg]:w-auto">
                <LogosLandscape code={false} />
              </Box>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Toggle sidebar"
                onClick={handleToggleSidebar}
                onMouseEnter={() => {
                  if (!sidebarOpen) beginSidebarPeek();
                }}
                onMouseLeave={() => {
                  // Grace only here: the pointer needs time to travel from
                  // the title-bar button down into the nav. Leaving the nav
                  // itself hides immediately.
                  if (!sidebarOpen) endSidebarPeek(300);
                }}
              >
                {sidebarOpen ? (
                  <SidebarClose size={10} />
                ) : (
                  <SidebarOpen size={10} />
                )}
              </Button>
            </Flex>
            <Flex align="center" gap="2" className="no-drag">
              <ButtonGroup className="no-drag">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Back"
                  disabled={!canGoBack}
                  onClick={goBack}
                >
                  <CaretLeftIcon size={14} />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Forward"
                  disabled={!canGoForward}
                  onClick={goForward}
                >
                  <CaretRightIcon size={14} />
                </Button>
              </ButtonGroup>
            </Flex>
          </Flex>
          {/* One strip for the window. Each pill is a whole tab (which may
              hold several panes — the pill then carries a layout glyph). */}
          <BrowserTabStrip />
          {/* Gated so an empty right-side group can't claim a no-drag rect
              in the title bar for nothing — every pixel without controls
              should drag the window. */}
          {(billingEnabled || channelsEnabled) && (
            <Flex align="center" gap="2" className="no-drag ml-auto pr-3">
              <UsageButton />
              {channelsEnabled && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!posthogWebUrl}
                  onClick={handleOpenPostHogWeb}
                >
                  <ArrowSquareOut size={14} />
                  PostHog Web
                </Button>
              )}
            </Flex>
          )}
        </Flex>
        <ConnectivityBanner />
        <Flex flexGrow="1" overflow="hidden" className="relative">
          {/* Invisible hover gutter: while the sidebar is collapsed, resting
              the pointer on the window's left edge peeks the sidebar out as an
              overlay. The panel (z-50) slides over this strip, so its own
              hover handlers take over keeping the peek alive. */}
          {!sidebarOpen && (
            <Box
              className="absolute inset-y-0 left-0 z-40 w-2"
              onMouseEnter={() => {
                // A drag-to-close sweeps the pointer through this strip —
                // peeking then would fight the drag.
                if (!sidebarIsResizing) beginSidebarPeek();
              }}
              onMouseLeave={() => endSidebarPeek()}
            />
          )}
          {/* Scrim under the peeked nav: dims the content while the overlay is
              out. Purely visual (pointer-transparent) and paired with the
              panel's slide — same 200ms ease-out — so they read as one unit. */}
          {!sidebarOpen && (
            <Box
              aria-hidden
              // The radix preset replaces Tailwind's palette, so plain
              // `bg-black/*` doesn't exist — use the radix black-alpha scale
              // (--black-a2 = 10%, --black-a5 = 30%).
              className={`pointer-events-none absolute inset-0 z-40 bg-blackA-2 transition-opacity duration-200 ease-out motion-reduce:transition-none dark:bg-blackA-5 ${
                sidebarPeek ? "opacity-100" : "opacity-0"
              }`}
            />
          )}
          <ChannelsSidebar />
          {/* Content sits in a bordered, rounded card inset from the window
              edges — the framed pane from the design. The active tab's pane
              tree renders inside it. */}
          <Box flexGrow="1" className="overflow-hidden">
            <Box
              className={`h-full overflow-hidden border-border border-t border-l bg-background ${
                sidebarOpen ? "rounded-tl-sm" : ""
              }`}
            >
              {children}
            </Box>
          </Box>
        </Flex>
        <CommandMenu open={commandMenuOpen} onOpenChange={setCommandMenuOpen} />
        <GlobalFilePicker />
        <KeyboardShortcutsSheet
          open={shortcutsSheetOpen}
          onOpenChange={(open) => (open ? null : closeShortcutsSheet())}
        />
        <GlobalEventHandlers
          onToggleCommandMenu={toggleCommandMenu}
          onToggleShortcutsSheet={toggleShortcutsSheet}
        />
        {/* Renders nothing — wires the ⌥↑/⌥↓ task-cycling shortcuts. */}
        <SpaceSwitcher
          tasks={visualTaskOrder}
          activeTaskId={activeTaskId}
          allTasks={tasks ?? []}
          isOnNewTask={
            view.type === "task-input" || view.type === "task-pending"
          }
          onNavigateToTask={openTask}
          onNewTask={openTaskInput}
        />
        <TourOverlay />
        {billingEnabled && <UsageLimitModal />}
        <UpdateAvailableModal />
        <WhatsNewModal />
        <RemoteBranchCheckoutDialog />
        <FeedbackModal
          mode={feedbackMode}
          onFinished={handleFeedbackFinished}
        />
        {approvalDeepLink.pending ? (
          <DeepLinkApprovalModal
            pending={approvalDeepLink.pending}
            onClose={approvalDeepLink.clear}
          />
        ) : null}
        <ExistingWorktreeDialog />
        <HedgehogMode />
      </Flex>
    </BrowserTabsDndProvider>
  );
}
