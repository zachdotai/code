import { InfoIcon } from "@phosphor-icons/react";
import { isNotActionableReport } from "@posthog/core/inbox/reportMembership";
import { InboxReportListTab } from "@posthog/ui/features/inbox/components/InboxReportListTab";
import {
  ReportCard,
  type ReportCardProps,
} from "@posthog/ui/features/inbox/components/ReportCard";

// Link cards (and their back navigation) at the Not actionable tab rather than
// the Reports tab.
function NotActionableReportCard(
  props: Extract<ReportCardProps, { variant?: "default" }>,
) {
  return <ReportCard {...props} detailTab="not-actionable" />;
}

/**
 * Staff-only (internal) tab listing reports the agentic actionability judgment
 * marked `not_actionable`. Same list shell as Pull requests / Reports — only the
 * predicate differs — so the team can audit signal quality. These reports are
 * kept out of the Reports tab (see `isReportTabReport`).
 */
export function NotActionableTab() {
  return (
    <InboxReportListTab
      predicate={isNotActionableReport}
      Card={NotActionableReportCard}
      searchPlaceholder="Search not-actionable reports…"
      emptyState={{
        Icon: InfoIcon,
        forYouTitle: "Nothing judged not-actionable for you",
        entireProjectTitle: "Nothing judged not-actionable yet",
        teammateTitle: "Nothing judged not-actionable for this reviewer",
        description:
          "Reports the agent decided aren't worth acting on land here, so the team can audit signal quality.",
      }}
    />
  );
}
