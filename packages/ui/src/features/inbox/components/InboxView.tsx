import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { isInboxDetailPath } from "@posthog/core/inbox/reportMembership";
import { InboxPageHeader } from "@posthog/ui/features/inbox/components/InboxPageHeader";
import {
  InboxOnboardingHeader,
  InboxOnboardingPane,
} from "@posthog/ui/features/inbox/components/onboarding/InboxOnboardingPane";
import {
  useInboxOnboardingSessionStore,
  useInboxOnboardingState,
} from "@posthog/ui/features/inbox/components/onboarding/useInboxOnboardingState";
import { useInboxAllReports } from "@posthog/ui/features/inbox/hooks/useInboxAllReports";
import { resetReportOpenTrackerHistory } from "@posthog/ui/features/inbox/hooks/useReportOpenTracker";
import { useTrackInboxViewed } from "@posthog/ui/features/inbox/hooks/useTrackInboxViewed";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { Flex, Text } from "@radix-ui/themes";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

/**
 * Inbox shell. Owns the in-page header (title + RFC subtitle + tab bar) and
 * the global-header chrome lockup. Tab bodies render via `<Outlet />` so each
 * sub-route renders the matching tab content full-width below the header.
 */
export function InboxView() {
  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="w-full min-w-0">
        <EnvelopeSimpleIcon size={12} className="shrink-0 text-gray-10" />
        <Text
          className="truncate whitespace-nowrap font-medium text-[13px]"
          title="Inbox"
        >
          Inbox
        </Text>
      </Flex>
    ),
    [],
  );

  useSetHeaderContent(headerContent);

  // Scope report-to-report navigation history to this inbox visit so the first
  // report opened after (re)entering the inbox has no stale previous_report_id.
  useEffect(() => {
    resetReportOpenTrackerHistory();
  }, []);

  useTrackInboxViewed();

  const { counts } = useInboxAllReports();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isDetailView = isInboxDetailPath(pathname);
  const onboarding = useInboxOnboardingState();
  const active = useInboxOnboardingSessionStore((s) => s.active);
  const finished = useInboxOnboardingSessionStore((s) => s.finished);
  const setActive = useInboxOnboardingSessionStore((s) => s.setActive);

  // Latch onboarding visibility once per session from `isComplete`. After that
  // the user only leaves by finishing the Activate step, so completing the last
  // step doesn't unmount the pane mid-flow.
  useEffect(() => {
    if (!onboarding.isLoading && active === null) {
      setActive(!onboarding.isComplete);
    }
  }, [onboarding.isLoading, onboarding.isComplete, active, setActive]);

  const showOnboarding =
    !isDetailView &&
    !onboarding.isLoading &&
    !finished &&
    (active === true || !onboarding.isComplete);

  return (
    <Flex direction="column" className="h-full min-h-0">
      {showOnboarding ? (
        <InboxOnboardingHeader />
      ) : (
        !isDetailView && <InboxPageHeader counts={counts} />
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {showOnboarding ? <InboxOnboardingPane /> : <Outlet />}
      </div>
    </Flex>
  );
}
