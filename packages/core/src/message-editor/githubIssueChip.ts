import type { GithubRefState } from "@posthog/shared";
import type { MentionChip } from "./content";
import type { ParsedGithubIssueUrl } from "./githubIssueUrl";

export interface GithubIssueChipSource {
  number: number;
  title: string;
  url: string;
}

export function githubIssueToMentionChip(
  issue: GithubIssueChipSource,
): MentionChip {
  return {
    type: "github_issue",
    id: issue.url,
    label: `#${issue.number} - ${issue.title}`,
  };
}

export function githubPullRequestToMentionChip(
  pr: GithubIssueChipSource,
): MentionChip {
  return {
    type: "github_pr",
    id: pr.url,
    label: `#${pr.number} - ${pr.title}`,
  };
}

export const GITHUB_ISSUE_STATE_COLORS: Record<GithubRefState, string> = {
  OPEN: "#238636",
  CLOSED: "#AB7DF8",
  MERGED: "#8957E5",
};

export function githubIssueStateColor(state: GithubRefState): string {
  return GITHUB_ISSUE_STATE_COLORS[state];
}

// Transient title shown on a github chip while its real title is being fetched.
// Kept as a shared constant so serialization and reconciliation can recognize
// (and never persist) the placeholder.
export const GITHUB_REF_PLACEHOLDER_TITLE = "Loading...";

const GITHUB_REF_PLACEHOLDER_LABEL_PATTERN = /^#\d+\s*-\s*Loading\.\.\.$/;

// True for a chip label still showing the "Loading..." placeholder, e.g. a ref
// pasted then submitted or persisted before its title finished loading.
export function isGithubRefPlaceholderLabel(label: string): boolean {
  return GITHUB_REF_PLACEHOLDER_LABEL_PATTERN.test(label);
}

export function buildGithubRefPlaceholderChip(
  parsed: ParsedGithubIssueUrl,
): MentionChip {
  const source = {
    number: parsed.number,
    title: GITHUB_REF_PLACEHOLDER_TITLE,
    url: parsed.normalizedUrl,
  };
  return parsed.kind === "pr"
    ? githubPullRequestToMentionChip(source)
    : githubIssueToMentionChip(source);
}
