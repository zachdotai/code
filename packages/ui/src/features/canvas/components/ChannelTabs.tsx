import { INBOX_PIPELINE_STATUS_FILTER } from "@posthog/core/inbox/reportFiltering";
import { Badge, Button, cn } from "@posthog/quill";
import { CHANNEL_SECTIONS } from "@posthog/ui/features/canvas/channelSections";
import { ChannelPinnedMenu } from "@posthog/ui/features/canvas/components/ChannelPinnedMenu";
import { useInboxReports } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { Link, useRouterState } from "@tanstack/react-router";

const TABS = CHANNEL_SECTIONS.map((s) => ({
  label: s.label,
  to: `/website/$channelId/${s.key}` as const,
}));

// Home / History / Artifacts tab switcher shown in the channel header bar, with
// a Pinned quick-access menu alongside. Pathname-driven active state (the
// codebase's convention) rather than Link's activeProps.
export function ChannelTabs({ channelId }: { channelId: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Live report count for the Inbox tab's badge — pipeline reports still needing
  // attention (the same status set the real Inbox badges), not every report ever
  // (which includes resolved/suppressed history). A cheap `limit: 1` count query
  // returns the real total without pulling the list. The tab itself is a
  // placeholder (no destination yet) — clicking is a no-op.
  const { data: inbox } = useInboxReports({
    status: INBOX_PIPELINE_STATUS_FILTER,
    limit: 1,
  });
  const inboxCount = inbox?.count ?? 0;

  return (
    <nav className="flex items-center gap-px">
      <Button type="button" variant="default" size="sm">
        Inbox
        {inboxCount > 0 && (
          <Badge variant="info" className="ms-0.5">
            {inboxCount}
          </Badge>
        )}
      </Button>
      {TABS.map((tab) => {
        const href = tab.to.replace("$channelId", channelId);
        const active = pathname === href;
        return (
          <Button
            key={tab.label}
            variant="default"
            size="sm"
            data-selected={active || undefined}
            className={cn(active && "bg-fill-selected")}
            render={<Link to={tab.to} params={{ channelId }} />}
          >
            {tab.label}
          </Button>
        );
      })}
      <ChannelPinnedMenu channelId={channelId} />
    </nav>
  );
}
