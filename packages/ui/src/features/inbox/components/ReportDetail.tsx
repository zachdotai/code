import {
  CopyIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import type { SignalReport } from "@posthog/shared/types";
import { ReportActivitySection } from "@posthog/ui/features/inbox/components/detail/ReportActivitySection";
import { InboxDetailFrame } from "@posthog/ui/features/inbox/components/InboxDetailFrame";
import { InboxReportDetailGate } from "@posthog/ui/features/inbox/components/InboxReportDetailGate";
import { ReportDetailActions } from "@posthog/ui/features/inbox/components/ReportDetailActions";
import { ReportTasksSection } from "@posthog/ui/features/inbox/components/ReportTasksSection";
import { SuggestedReviewersSection } from "@posthog/ui/features/inbox/components/SuggestedReviewersSection";
import { copyInboxReportLink } from "@posthog/ui/features/inbox/utils/copyInboxReportLink";

/** Tabs whose detail view renders a `ReportDetail`. */
type ReportDetailBackTo = "/code/inbox/reports" | "/code/inbox/not-actionable";

interface ReportDetailProps {
  reportId: string;
  cachedReport?: SignalReport | null;
  /** Where the back link points. Defaults to the Reports tab. */
  backTo?: ReportDetailBackTo;
  /** Label for the back link. Defaults to "Back to reports". */
  backLabel?: string;
}

export function ReportDetail({
  reportId,
  cachedReport = null,
  backTo = "/code/inbox/reports",
  backLabel = "Back to reports",
}: ReportDetailProps) {
  return (
    <InboxReportDetailGate
      reportId={reportId}
      cachedReport={cachedReport}
      backTo={backTo}
      backLabel={backLabel}
      missingCopy="This report couldn't be found. It may have been deleted."
    >
      {(report) => (
        <ReportDetailContent
          report={report}
          backTo={backTo}
          backLabel={backLabel}
        />
      )}
    </InboxReportDetailGate>
  );
}

function ReportDetailContent({
  report,
  backTo,
  backLabel,
}: {
  report: SignalReport;
  backTo: ReportDetailBackTo;
  backLabel: string;
}) {
  return (
    <InboxDetailFrame
      report={report}
      backTo={backTo}
      backLabel={backLabel}
      fallbackTitle="Untitled report"
      primaryAction={
        <>
          <ReportDetailActions report={report} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => copyInboxReportLink(report)}
            title="Copy a deep link to this report"
          >
            <CopyIcon size={12} />
          </Button>
        </>
      }
      summarySection={{ Icon: FileTextIcon, title: "Summary" }}
      evidenceSection={{ Icon: MagnifyingGlassIcon, title: "Evidence" }}
    >
      <ReportTasksSection report={report} />
      <SuggestedReviewersSection report={report} />
      <ReportActivitySection reportId={report.id} />
    </InboxDetailFrame>
  );
}
