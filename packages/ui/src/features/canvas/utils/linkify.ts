const URL_PATTERN = /https?:\/\/[^\s<>]+/gi;

export interface LinkTextSegment {
  type: "text";
  text: string;
}

export interface LinkUrlSegment {
  type: "link";
  text: string;
  href: string;
}

export type LinkSegment = LinkTextSegment | LinkUrlSegment;

/**
 * Trailing punctuation reads as prose, not part of the URL; a `)` is kept only
 * when it closes a paren opened inside the URL (e.g. Wikipedia paths).
 */
function trimTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0) {
    const char = url[end - 1] as string;
    if (".,;:!?'\"]}".includes(char)) {
      end--;
      continue;
    }
    if (char === ")") {
      const body = url.slice(0, end);
      const opens = body.split("(").length - 1;
      const closes = body.split(")").length - 1;
      if (closes > opens) {
        end--;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

// A markdown `[label](url)` link whose target is an http(s) URL or an in-app
// route path (`/…`). Requiring a scheme or a leading slash keeps this from
// matching mention tokens (`@[Name](email)`) — those carry a bare email, and
// are split out before link parsing runs anyway.
const MARKDOWN_LINK_PATTERN = /\[([^\]\n]+)\]\(((?:https?:\/\/|\/)[^\s()]+)\)/g;

/**
 * Like {@link splitLinkSegments}, but also renders markdown `[label](url)`
 * links (the label becomes the link text). Bare URLs in between still linkify.
 * Used where authors type markdown (the demo message composer); plain thread
 * messages keep the bare-URL-only behavior.
 */
export function splitRichLinkSegments(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let lastIndex = 0;
  MARKDOWN_LINK_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      // Bare URLs in the run of text before this markdown link.
      segments.push(...splitLinkSegments(text.slice(lastIndex, index)));
    }
    segments.push({ type: "link", text: match[1] ?? "", href: match[2] ?? "" });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push(...splitLinkSegments(text.slice(lastIndex)));
  }
  return segments;
}

/** Split plain text into text and http(s) link segments, in document order. */
export function splitLinkSegments(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let lastIndex = 0;
  URL_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimTrailingPunctuation(match[0]);
    if (!url) continue;
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, index) });
    }
    segments.push({ type: "link", text: url, href: url });
    lastIndex = index + url.length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }
  return segments;
}
