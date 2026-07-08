import { File, Folder, Warning } from "@phosphor-icons/react";
import { unescapeXmlAttr } from "@posthog/shared";
import { Text } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { memo } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { GithubRefChip } from "../../../editor/components/GithubRefChip";
import {
  baseComponents,
  defaultRemarkPlugins,
} from "../../../editor/components/MarkdownRenderer";

const MENTION_TAG_REGEX =
  /<file\s+path="([^"]+)"\s*\/>|<(github_issue|github_pr)\s+number="([^"]+)"(?:\s+title="([^"]*)")?(?:\s+url="([^"]*)")?\s*\/>|<error_context\s+label="([^"]*)">[\s\S]*?<\/error_context>|<folder\s+path="([^"]+)"\s*\/>/g;
const MENTION_TAG_TEST =
  /<(?:file\s+path|folder\s+path|github_issue\s+number|github_pr\s+number|error_context\s+label)="[^"]+"/;
// Matches every slash command in the string, at the start or after whitespace —
// not just the leading one. Submitted prompts have their <skill /> tags flattened
// to plain /name text, so a prompt using several skills arrives here as multiple
// /name tokens that each need a chip.
const SLASH_COMMAND_REGEX = /(^|\s)\/([a-zA-Z][\w-]*)(?=\s|$)/g;
const SLASH_COMMAND_TEST = /(?:^|\s)\/[a-zA-Z][\w-]*(?=\s|$)/;

const inlineComponents: Components = {
  ...baseComponents,
  p: ({ children }) => (
    <Text as="span" color="gray" highContrast className="text-[13px]">
      {children}
    </Text>
  ),
};

export const InlineMarkdown = memo(function InlineMarkdown({
  content,
}: {
  content: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={defaultRemarkPlugins}
      components={inlineComponents}
    >
      {content}
    </ReactMarkdown>
  );
});

export function hasMentionTags(content: string): boolean {
  return MENTION_TAG_TEST.test(content) || SLASH_COMMAND_TEST.test(content);
}

export const hasFileMentions = hasMentionTags;

const chipClass =
  "inline-flex min-w-0 max-w-full items-center gap-1 rounded-[var(--radius-1)] bg-[var(--accent-a3)] px-1 py-px align-middle font-medium text-[var(--accent-11)]";

export function MentionChip({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  const style = { margin: "0 2px" };

  const content = (
    <>
      {icon}
      <span className="truncate">{label}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`${chipClass} cursor-pointer border-none text-[13px]`}
        onClick={onClick}
        style={style}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={`${chipClass} text-[13px]`} style={style}>
      {content}
    </span>
  );
}

interface MentionMatch {
  start: number;
  end: number;
  node: ReactNode;
}

function collectMentionMatches(content: string): MentionMatch[] {
  const matches: MentionMatch[] = [];

  for (const match of content.matchAll(SLASH_COMMAND_REGEX)) {
    // Group 1 is the leading start-of-string/whitespace boundary; keep it as
    // surrounding text so only the /command itself becomes a chip.
    const leading = match[1] ?? "";
    const start = (match.index ?? 0) + leading.length;
    matches.push({
      start,
      end: start + match[0].length - leading.length,
      node: (
        <MentionChip
          key={`slash-${start}`}
          icon={null}
          label={`/${match[2]}`}
        />
      ),
    });
  }

  for (const match of content.matchAll(MENTION_TAG_REGEX)) {
    const matchIndex = match.index ?? 0;
    let node: ReactNode = null;

    if (match[1]) {
      const filePath = unescapeXmlAttr(match[1]);
      const segments = filePath.split("/").filter(Boolean);
      const fileName = segments.pop() ?? filePath;
      const parentDir = segments.pop();
      const label = parentDir ? `${parentDir}/${fileName}` : fileName;
      node = (
        <MentionChip
          key={`file-${matchIndex}`}
          icon={<File size={12} />}
          label={label}
        />
      );
    } else if (match[2]) {
      const kind = match[2] === "github_pr" ? "pr" : "issue";
      const issueNumber = match[3];
      const issueTitle = match[4] ? unescapeXmlAttr(match[4]) : undefined;
      const issueUrl = match[5] ? unescapeXmlAttr(match[5]) : "";
      const label = issueTitle
        ? `#${issueNumber} - ${issueTitle}`
        : `#${issueNumber}`;
      node = (
        <GithubRefChip
          key={`${match[2]}-${matchIndex}`}
          href={issueUrl}
          kind={kind}
        >
          {label}
        </GithubRefChip>
      );
    } else if (match[6]) {
      node = (
        <MentionChip
          key={`error-ctx-${matchIndex}`}
          icon={<Warning size={12} />}
          label={unescapeXmlAttr(match[6])}
        />
      );
    } else if (match[7]) {
      const folderPath = unescapeXmlAttr(match[7]);
      const segments = folderPath.split("/").filter(Boolean);
      const folderName = segments.pop() ?? folderPath;
      node = (
        <MentionChip
          key={`folder-${matchIndex}`}
          icon={<Folder size={12} />}
          label={folderName}
        />
      );
    }

    if (node) {
      matches.push({
        start: matchIndex,
        end: matchIndex + match[0].length,
        node,
      });
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

export function parseMentionTags(content: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const { start, end, node } of collectMentionMatches(content)) {
    if (start < lastIndex) continue;

    if (start > lastIndex) {
      parts.push(
        <InlineMarkdown
          key={`text-${lastIndex}`}
          content={content.slice(lastIndex, start)}
        />,
      );
    }

    parts.push(node);
    lastIndex = end;
  }

  if (lastIndex < content.length) {
    parts.push(
      <InlineMarkdown
        key={`text-${lastIndex}`}
        content={content.slice(lastIndex)}
      />,
    );
  }

  return parts;
}

export const parseFileMentions = parseMentionTags;
