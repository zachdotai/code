import { GitPullRequestIcon } from "@phosphor-icons/react";
import { GithubRefChip } from "@posthog/ui/features/editor/components/GithubRefChip";
import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { ToolRow } from "@posthog/ui/features/sessions/components/session-update/ToolRow";
import { memo } from "react";

interface AutomatedCheckMessageProps {
  /** Discriminates the automated action, e.g. "pr_ci_followup". */
  checkKind: string;
  /** The full injected prompt, revealed when the row is expanded. */
  content: string;
  /** 1-based repetition index and cap, when the backend supplies them. */
  iteration?: number;
  maxIterations?: number;
  /** PR the check concerns, rendered as a clickable chip. */
  prUrl?: string;
}

const LABEL_BY_KIND: Record<string, string> = {
  pr_ci_followup: "Automated CI check",
};

function prNumberFromUrl(url: string): string | null {
  const match = url.match(/\/pull\/(\d+)/);
  return match ? `#${match[1]}` : null;
}

/**
 * A backend-tagged automated re-entry (e.g. the CI "babysitter" follow-up).
 * Renders as a muted, collapsed row — the injected prompt is tucked behind a
 * click so it no longer floods the thread as a user-voiced wall of text, and
 * the distinct icon/label makes clear the turn wasn't started by the user.
 */
function AutomatedCheckMessageImpl({
  checkKind,
  content,
  iteration,
  maxIterations,
  prUrl,
}: AutomatedCheckMessageProps) {
  const label = LABEL_BY_KIND[checkKind] ?? "Automated check";
  const progress =
    iteration != null && maxIterations != null
      ? `${iteration} of ${maxIterations}`
      : iteration != null
        ? `attempt ${iteration}`
        : null;
  const prNumber = prUrl ? prNumberFromUrl(prUrl) : null;

  return (
    <div className="pl-3">
      <ToolRow
        icon={GitPullRequestIcon}
        content={<MarkdownRenderer content={content} />}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] text-gray-11">
          <span className="font-medium">{label}</span>
          {progress ? <span className="text-gray-9">· {progress}</span> : null}
          {prUrl && prNumber ? (
            <GithubRefChip href={prUrl} kind="pr">
              {prNumber}
            </GithubRefChip>
          ) : null}
        </span>
      </ToolRow>
    </div>
  );
}

export const AutomatedCheckMessage = memo(AutomatedCheckMessageImpl);
