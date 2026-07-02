import { GitPullRequestIcon } from "@phosphor-icons/react";
import { GithubRefChip } from "@posthog/ui/features/editor/components/GithubRefChip";
import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { ToolRow } from "@posthog/ui/features/sessions/components/session-update/ToolRow";
import { memo, type ReactNode } from "react";

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
  /**
   * The re-entry's turn is still running — show a spinner in the icon slot so
   * the row reads as actively working rather than a finished, static message.
   */
  isActive?: boolean;
  /**
   * Short summary of the turn's work (e.g. "Ran 3 commands, edited a file"),
   * appended after the header when the whole turn is folded into this row.
   */
  summary?: string;
  /**
   * Controlled open state for the folded-turn variant. Omit for the standalone
   * compact row, which manages its own open state.
   */
  expanded?: boolean;
  onToggle?: (open: boolean) => void;
  /** The turn's body (tool calls + prose), revealed under the prompt when expanded. */
  body?: ReactNode;
}

const LABEL_BY_KIND: Record<string, string> = {
  pr_ci_followup: "Automated CI check",
};

// Only treat genuine github.com PR URLs as linkable. `prUrl` arrives from the
// backend `_meta` and the chip opens it via `window.open`, so validate the
// origin here rather than trusting a bare `/pull/<n>` substring (which a URL
// like `https://attacker.example.com/pull/42` would otherwise satisfy).
function prNumberFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    return null;
  }
  const match = parsed.pathname.match(/^\/[^/]+\/[^/]+\/pull\/(\d+)/);
  return match ? `#${match[1]}` : null;
}

/**
 * A backend-tagged automated re-entry (e.g. the CI "babysitter" follow-up).
 * Renders as a muted, collapsed row — the injected prompt (and, when the whole
 * turn is folded in, its tool calls + prose) is tucked behind a click so it no
 * longer floods the thread as a user-voiced wall of text, and the distinct
 * icon/label makes clear the turn wasn't started by the user.
 *
 * Two shapes share this row: the standalone compact message (uncontrolled, just
 * the prompt) and the folded whole turn (controlled open state, a work summary,
 * a spinner while running, and the turn body as `body`).
 */
function AutomatedCheckMessageImpl({
  checkKind,
  content,
  iteration,
  maxIterations,
  prUrl,
  isActive,
  summary,
  expanded,
  onToggle,
  body,
}: AutomatedCheckMessageProps) {
  const label = LABEL_BY_KIND[checkKind] ?? "Automated check";
  const progress =
    iteration != null && maxIterations != null
      ? `${iteration} of ${maxIterations}`
      : iteration != null
        ? `attempt ${iteration}`
        : null;
  const prNumber = prUrl ? prNumberFromUrl(prUrl) : null;

  const isControlled = expanded !== undefined;
  // Uncontrolled (standalone) always mounts the prompt so ToolRow drives its own
  // open state. Controlled (folded turn) omits the body while collapsed so the
  // turn's tool/diff views don't render behind a closed row; `collapsible` keeps
  // the trigger regardless.
  const showBody = !isControlled || expanded;
  const bodyContent = showBody ? (
    <>
      <MarkdownRenderer content={content} />
      {body}
    </>
  ) : undefined;

  return (
    <div className="pl-3">
      <ToolRow
        icon={GitPullRequestIcon}
        isLoading={isActive}
        collapsible
        content={bodyContent}
        open={isControlled ? expanded : undefined}
        onOpenChange={onToggle}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] text-gray-11">
          <span className="font-medium">{label}</span>
          {progress ? <span className="text-gray-9">· {progress}</span> : null}
          {prUrl && prNumber ? (
            <GithubRefChip href={prUrl} kind="pr">
              {prNumber}
            </GithubRefChip>
          ) : null}
          {summary ? (
            <span className="min-w-0 truncate text-gray-9">· {summary}</span>
          ) : null}
        </span>
      </ToolRow>
    </div>
  );
}

export const AutomatedCheckMessage = memo(AutomatedCheckMessageImpl);
