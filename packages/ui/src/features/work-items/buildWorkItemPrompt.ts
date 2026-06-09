import type { PrWorkItem } from "@posthog/core/git/router-schemas";
import {
  contentToXml,
  type EditorContent,
} from "@posthog/core/message-editor/content";
import { githubPullRequestToMentionChip } from "@posthog/core/message-editor/githubIssueChip";

const KIND_INSTRUCTION: Record<PrWorkItem["kind"], string> = {
  review:
    "Address the requested review changes on this pull request. Read the unresolved review comments, make the changes, reply where useful, and push.",
  ci: "Investigate and fix the failing CI checks on this pull request. Reproduce the failure locally, fix the root cause, and push.",
  conflict:
    "Resolve the merge conflicts on this pull request. Rebase the branch on the default branch, resolve each conflict, and push.",
};

/**
 * Builds the pre-filled prompt for a PR work item as editor XML: the PR is a
 * real `github_pr` mention chip (so it renders as a pill and the agent gets a
 * structured reference), with the head branch as a hint to check out.
 */
export function buildWorkItemPrompt(item: PrWorkItem): string {
  const chip = githubPullRequestToMentionChip({
    number: item.prNumber,
    title: item.title,
    url: item.url,
  });
  const content: EditorContent = {
    segments: [
      { type: "text", text: `${KIND_INSTRUCTION[item.kind]}\n\nPR: ` },
      { type: "chip", chip },
      { type: "text", text: `\nBranch: ${item.headRefName}` },
    ],
  };
  return contentToXml(content);
}
