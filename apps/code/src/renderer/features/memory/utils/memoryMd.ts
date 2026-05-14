export interface ParsedMemoryMd {
  frontmatter: string;
  title: string;
  preSection: string;
  sections: Map<string, string>;
  sectionOrder: string[];
}

const DEFAULT_FRONTMATTER = `---
name: Memory Index
description: Personal memory index
type: context
---

`;

const DEFAULT_TITLE = "# Memory";

export function parseMemoryMd(content: string): ParsedMemoryMd {
  const fmMatch = content.match(/^(---\s*\n[\s\S]*?\n---\s*\n)/);
  const frontmatter = fmMatch ? fmMatch[1] : DEFAULT_FRONTMATTER;
  let rest = content.slice(fmMatch ? fmMatch[1].length : 0);

  // Extract optional H1 title line as the page title.
  let title = DEFAULT_TITLE;
  const titleMatch = rest.match(/^\s*(#[^\n]*)\n+/);
  if (titleMatch) {
    title = titleMatch[1].trim();
    rest = rest.slice(titleMatch[0].length);
  }

  const sections = new Map<string, string>();
  const sectionOrder: string[] = [];
  const preLines: string[] = [];
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  for (const line of rest.split("\n")) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      if (currentHeading !== null) {
        sections.set(currentHeading, currentBody.join("\n").trim());
        sectionOrder.push(currentHeading);
      } else {
        preLines.push(...currentBody);
      }
      currentHeading = headingMatch[1];
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  if (currentHeading !== null) {
    sections.set(currentHeading, currentBody.join("\n").trim());
    sectionOrder.push(currentHeading);
  } else {
    preLines.push(...currentBody);
  }

  return {
    frontmatter,
    title,
    preSection: preLines.join("\n").trim(),
    sections,
    sectionOrder,
  };
}

export function renderMemoryMd(parsed: ParsedMemoryMd): string {
  const parts: string[] = [];
  parts.push(parsed.frontmatter.trimEnd());
  parts.push("");
  parts.push(parsed.title);
  parts.push("");
  if (parsed.preSection) {
    parts.push(parsed.preSection);
    parts.push("");
  }
  for (const heading of parsed.sectionOrder) {
    const body = parsed.sections.get(heading);
    if (body === undefined) continue;
    parts.push(`## ${heading}`);
    parts.push("");
    if (body.trim()) {
      parts.push(body.trim());
      parts.push("");
    }
  }
  return `${parts
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

export function setSection(
  parsed: ParsedMemoryMd,
  heading: string,
  body: string,
): ParsedMemoryMd {
  const sections = new Map(parsed.sections);
  let sectionOrder = [...parsed.sectionOrder];

  const trimmed = body.trim();
  if (trimmed.length === 0) {
    sections.delete(heading);
    sectionOrder = sectionOrder.filter((h) => h !== heading);
  } else {
    sections.set(heading, trimmed);
    if (!sectionOrder.includes(heading)) {
      sectionOrder.push(heading);
    }
  }

  return { ...parsed, sections, sectionOrder };
}

export function getSection(
  parsed: ParsedMemoryMd,
  heading: string,
): string | undefined {
  return parsed.sections.get(heading);
}

/**
 * Standard section headings the Memory home view manages. Anything not in this
 * list is preserved verbatim during edits.
 */
export const STANDARD_SECTIONS = {
  me: "Me",
  focus: "Current focus",
  glossary: "Glossary",
  workingStyle: "Working style",
  findThings: "Where to find things",
} as const;

const EDITED_MARKER_RE = /_Edited: (\d{4}-\d{2}-\d{2})_\s*$/;

export interface SectionBody {
  /** The body content visible to the editor (marker stripped). */
  visible: string;
  /** YYYY-MM-DD if a marker was present, else null. */
  lastEdited: string | null;
}

/**
 * Splits a section body into its user-visible content and the trailing
 * `_Edited: YYYY-MM-DD_` marker if present.
 */
export function readSectionBody(body: string): SectionBody {
  const match = body.match(EDITED_MARKER_RE);
  if (!match) return { visible: body.trim(), lastEdited: null };
  return {
    visible: body.replace(EDITED_MARKER_RE, "").trim(),
    lastEdited: match[1],
  };
}

/**
 * Appends today's date as an `_Edited: YYYY-MM-DD_` marker to the section body.
 * If a marker already exists, it's replaced.
 */
export function stampSectionBody(body: string, now: Date = new Date()): string {
  const visible = body.replace(EDITED_MARKER_RE, "").trim();
  if (!visible) return "";
  const stamp = formatDate(now);
  return `${visible}\n\n_Edited: ${stamp}_`;
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Formats a unix-ms timestamp relative to now. */
export function formatRelativeMs(
  mtimeMs: number,
  now: Date = new Date(),
): string {
  return formatRelative(formatDate(new Date(mtimeMs)), now);
}

/** Formats a date relative to now ("3 days ago", "today", "1 month ago"). */
export function formatRelative(
  isoDate: string,
  now: Date = new Date(),
): string {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const ms = now.getTime() - d.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return isoDate;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
