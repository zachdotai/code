/// <reference path="../../../types/joplin-turndown-plugin-gfm.d.ts" />
import { gfm } from "@joplin/turndown-plugin-gfm";
import TurndownService from "turndown";

let turndown: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (turndown) return turndown;
  turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  turndown.use(gfm); // tables, strikethrough, task lists
  // Drop non-content elements outright. macOS puts a <style> block in the
  // clipboard HTML when copying rich text from native apps (Notes, Mail,
  // Slack), and Turndown would otherwise emit its CSS as text, e.g.
  // "p.p1 {margin: 0.0px ...; font: 18.0px Helvetica}" before the real text.
  turndown.remove(["style", "script", "head", "title", "meta", "link"]);
  // The composer is plain-text, so we only want structural formatting
  // (headings, lists, links, tables, code) preserved as Markdown. Turndown's
  // default escaping is meant for round-tripping Markdown and mangles ordinary
  // text — "1." -> "1\.", "snake_case" -> "snake\_case", "[x]" -> "\[x\]".
  // Disabling it keeps plain text intact so it also stays equal to the
  // plain-text fallback below and defers to the editor's native paste.
  turndown.escape = (text) => text;
  return turndown;
}

/** Convert clipboard HTML to Markdown. Returns null when it adds nothing over the plain-text fallback. */
export function htmlToMarkdown(
  html: string,
  plainTextFallback?: string,
): string | null {
  const markdown = getTurndown().turndown(html).trim();
  if (!markdown) return null;

  // No formatting beyond the plain text; defer to the default paste.
  if (
    plainTextFallback !== undefined &&
    markdown === plainTextFallback.trim()
  ) {
    return null;
  }

  return markdown;
}

const NON_CONTENT_TAGS = new Set(["META", "STYLE", "SCRIPT", "TITLE", "LINK"]);
const CODE_STRUCTURE_TAGS = new Set(["DIV", "SPAN", "BR"]);

/**
 * True for the clipboard HTML shape code editors produce (VS Code/Monaco,
 * JetBrains): a single `white-space: pre` block — or a bare `<pre>` — whose
 * only structure is per-line <div>s of colored <span>s. That shape carries no
 * formatting the composer keeps, and neither conversion handles it faithfully:
 * Turndown emits a paragraph per line <div> (a blank line between every code
 * line), and ProseMirror's native HTML paste splits the lines into separate
 * paragraphs, which serialize back with blank lines too. Callers should paste
 * the clipboard's plain text verbatim instead. Web code blocks (<pre><code>)
 * are excluded; Turndown converts those to fenced Markdown correctly.
 */
export function isCodeEditorHtml(html: string): boolean {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const roots = Array.from(body.children).filter(
    (el) => !NON_CONTENT_TAGS.has(el.tagName),
  );
  if (roots.length !== 1) return false;

  const root = roots[0];
  const isPre = root.tagName === "PRE";
  const whiteSpace = root instanceof HTMLElement ? root.style.whiteSpace : "";
  if (!isPre && !whiteSpace.startsWith("pre")) return false;
  if (isPre && root.firstElementChild?.tagName === "CODE") return false;

  for (const el of root.querySelectorAll("*")) {
    if (!CODE_STRUCTURE_TAGS.has(el.tagName)) return false;
  }
  return true;
}
