import type {
  SignalReport,
  SignalReportArtefactsResponse,
  SuggestedReviewer,
} from "../../../shared/types";

type Artefact = SignalReportArtefactsResponse["results"][number];

/**
 * Builds the markdown prompt sent to a fresh cloud Task spawned from a Signals
 * Inbox report. Title / summary / per-signal findings / suggested reviewers,
 * each one optional and collapsing silently when missing — same shape an
 * operator would write when clicking "Run agent" on an Inbox card.
 */
export interface SignalPromptInputs {
  report: Pick<SignalReport, "id" | "title" | "summary">;
  artefacts: Artefact[];
}

export function buildSignalPrompt({
  report,
  artefacts,
}: SignalPromptInputs): string {
  const lines: string[] = [];
  const title = report.title?.trim();
  if (title) lines.push(`# ${title}`);

  const summary = report.summary?.trim();
  if (summary) {
    lines.push("");
    lines.push(summary);
  }

  const findings = artefacts.filter((a) => a.type === "signal_finding");
  if (findings.length > 0) {
    lines.push("");
    lines.push("## Findings");
    for (const f of findings) {
      const content = f.content as unknown as {
        relevant_code_paths?: string[];
        relevant_commit_hashes?: Record<string, string>;
        data_queried?: string;
        verified?: boolean;
      };
      const paths = content.relevant_code_paths ?? [];
      const commits = Object.keys(content.relevant_commit_hashes ?? {});
      const data = content.data_queried?.trim();
      if (paths.length > 0) {
        lines.push(`- Relevant paths: ${paths.join(", ")}`);
      }
      if (commits.length > 0) {
        lines.push(`- Relevant commits: ${commits.slice(0, 5).join(", ")}`);
      }
      if (data) {
        lines.push(`- Data queried: ${data}`);
      }
    }
  }

  const reviewers = extractReviewers(artefacts);
  if (reviewers.length > 0) {
    lines.push("");
    lines.push("## Suggested reviewers");
    for (const r of reviewers) {
      const name = r.github_name ?? r.github_login;
      lines.push(
        `- @${r.github_login}${
          name && name !== r.github_login ? ` (${name})` : ""
        }`,
      );
    }
  }

  lines.push("");
  lines.push(`_Source: signal report ${report.id}_`);

  return lines.join("\n").trim();
}

function extractReviewers(artefacts: Artefact[]): SuggestedReviewer[] {
  for (const a of artefacts) {
    if (a.type === "suggested_reviewers") {
      const content = a.content as unknown as SuggestedReviewer[];
      if (Array.isArray(content)) return content;
    }
  }
  return [];
}
