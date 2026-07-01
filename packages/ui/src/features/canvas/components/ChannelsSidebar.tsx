import {
  GearSixIcon,
  HouseIcon,
  SlidersHorizontalIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { HOME_TAB_FLAG } from "@posthog/shared/constants";
import { ChannelsList } from "@posthog/ui/features/canvas/components/ChannelsList";
import { useChannelsSidebarStore } from "@posthog/ui/features/canvas/components/channelsSidebarStore";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useInboxAllReports } from "@posthog/ui/features/inbox/hooks/useInboxAllReports";
import { openSettings } from "@posthog/ui/features/settings/hooks/useOpenSettings";
import { AgentsItem } from "@posthog/ui/features/sidebar/components/items/AgentsItem";
import { InboxItem } from "@posthog/ui/features/sidebar/components/items/InboxItem";
import { SearchItem } from "@posthog/ui/features/sidebar/components/items/SearchItem";
import { ProjectSwitcher } from "@posthog/ui/features/sidebar/components/ProjectSwitcher";
import { SidebarItem } from "@posthog/ui/features/sidebar/components/SidebarItem";
import { UpdateBanner } from "@posthog/ui/features/sidebar/components/UpdateBanner";
import { ResizableSidebar } from "@posthog/ui/primitives/ResizableSidebar";
import {
  navigateToCanvas,
  navigateToWebsiteAgents,
  navigateToWebsiteCustomize,
  navigateToWebsiteHome,
  navigateToWebsiteInbox,
} from "@posthog/ui/router/navigationBridge";
import { useAppView } from "@posthog/ui/router/useAppView";
import { track } from "@posthog/ui/shell/analytics";
import { useCommandMenuStore } from "@posthog/ui/shell/commandMenuStore";
import { Box, Flex } from "@radix-ui/themes";
import { useRouterState } from "@tanstack/react-router";

// Fire a nav_click event, then run the destination's navigation.
function trackNav(navTarget: string, navigate: () => void) {
  track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
    action_type: "nav_click",
    surface: "nav",
    nav_target: navTarget,
  });
  navigate();
}

// Non-canvas /website surfaces — used to tell whether the current /website route
// is a canvas surface (channels index / a channel / a dashboard) so the Canvas
// nav item highlights only there.
const NON_CANVAS_WEBSITE_PREFIXES = [
  "/website/home",
  "/website/inbox",
  "/website/agents",
  "/website/customize",
  "/website/command-center",
];

// The channels-space global nav. It mirrors the Code view's top items —
// Search, Inbox, Agents — but every destination stays inside the Channels
// space (the /website mirrors) so navigating never bounces back to /code. Order:
// Home · Search · Inbox · Canvas · Agents · Customize. The channel tree below is
// channel browsing.
function ChannelsNav() {
  const view = useAppView();
  const homeTabEnabled = useFeatureFlag(HOME_TAB_FLAG);
  const openCommandMenu = useCommandMenuStore((s) => s.open);
  // Same PR-review count the Code view's Inbox item shows; `ignoreFilters` keeps
  // the badge stable against the inbox's filter chrome.
  const { counts: inboxCounts } = useInboxAllReports({ ignoreFilters: true });
  // Active on the canvas surfaces: the channels index, a channel, or a canvas —
  // any /website route that isn't one of the non-canvas surfaces above.
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isCanvasActive =
    path.startsWith("/website") &&
    !NON_CANVAS_WEBSITE_PREFIXES.some((p) => path.startsWith(p));
  const isCustomizeActive = path.startsWith("/website/customize");

  return (
    <Flex direction="column" className="shrink-0 gap-px px-2 py-2">
      {homeTabEnabled && (
        <SidebarItem
          depth={0}
          icon={
            <HouseIcon
              size={16}
              weight={view.type === "home" ? "fill" : "regular"}
            />
          }
          label="Home"
          isActive={view.type === "home"}
          onClick={() => trackNav("home", navigateToWebsiteHome)}
        />
      )}
      <SearchItem onClick={() => trackNav("search", openCommandMenu)} />
      <InboxItem
        isActive={view.type === "inbox"}
        onClick={() => trackNav("inbox", navigateToWebsiteInbox)}
        pullRequestCount={inboxCounts.pulls}
      />
      <SidebarItem
        depth={0}
        icon={
          <SquaresFourIcon
            size={16}
            weight={isCanvasActive ? "fill" : "regular"}
          />
        }
        label="Canvas"
        isActive={isCanvasActive}
        onClick={() => trackNav("canvas", navigateToCanvas)}
      />
      <AgentsItem
        isActive={view.type === "agents"}
        onClick={() => trackNav("agents", navigateToWebsiteAgents)}
      />
      <SidebarItem
        depth={0}
        icon={
          <SlidersHorizontalIcon
            size={16}
            weight={isCustomizeActive ? "fill" : "regular"}
          />
        }
        label="Customize"
        isActive={isCustomizeActive}
        onClick={() => trackNav("customize", navigateToWebsiteCustomize)}
      />
    </Flex>
  );
}

// The Channels-space sidebar: a single column owning the whole left pane. Top to
// bottom — workspace switcher, global nav, the channel tree, then Settings
// pinned to the bottom. There is no app rail in this space; the nav rows above
// are the cross-app navigation.
export function ChannelsSidebar() {
  const width = useChannelsSidebarStore((state) => state.width);
  const setWidth = useChannelsSidebarStore((state) => state.setWidth);
  const isResizing = useChannelsSidebarStore((state) => state.isResizing);
  const setIsResizing = useChannelsSidebarStore((state) => state.setIsResizing);

  return (
    <ResizableSidebar
      open
      width={width}
      setWidth={setWidth}
      isResizing={isResizing}
      setIsResizing={setIsResizing}
      side="left"
    >
      <Flex direction="column" className="h-full bg-chrome">
        {/* Workspace switcher — a compact bordered button. The title bar above
            provides the window-drag region and stoplight clearance. */}
        <Box className="shrink-0 px-2 pb-0">
          <ProjectSwitcher triggerVariant="button" />
        </Box>

        {/* The global nav links stay pinned below the switcher; only the channel
            tree scrolls when it overflows. */}
        <ChannelsNav />
        <Box className="scroll-mask-4 min-h-0 flex-1 overflow-y-auto">
          <ChannelsList />
        </Box>

        <UpdateBanner />

        {/* Settings pinned to the bottom. Settings is a full-page route, so this
            leaves the Channels space rather than highlighting in place. */}
        <Box className="shrink-0 border-border border-t p-2">
          <SidebarItem
            depth={0}
            icon={<GearSixIcon size={16} />}
            label="Settings"
            onClick={() => trackNav("settings", () => openSettings())}
          />
        </Box>
      </Flex>
    </ResizableSidebar>
  );
}
