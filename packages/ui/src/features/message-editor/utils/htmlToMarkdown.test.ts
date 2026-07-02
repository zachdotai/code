import { describe, expect, it } from "vitest";
import { htmlToMarkdown, isCodeEditorHtml } from "./htmlToMarkdown";

describe("htmlToMarkdown", () => {
  it.each([
    [
      "headings, emphasis and links",
      "<h1>Title</h1><p>Some <strong>bold</strong> and <em>italic</em> with a <a href='https://posthog.com'>link</a>.</p>",
      "# Title\n\nSome **bold** and *italic* with a [link](https://posthog.com).",
    ],
    [
      "unordered lists",
      "<ul><li>one</li><li>two</li></ul>",
      "-   one\n-   two",
    ],
    [
      "tables via the gfm plugin",
      "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |",
    ],
    [
      "fenced code blocks",
      "<pre><code>const x = 1;</code></pre>",
      "```\nconst x = 1;\n```",
    ],
  ])("converts %s", (_, html, expected) => {
    expect(htmlToMarkdown(html)).toBe(expected);
  });

  it("returns null when there is no formatting beyond the plain-text fallback", () => {
    const html = "<p>just text</p>";
    expect(htmlToMarkdown(html, "just text")).toBeNull();
  });

  it("returns null for empty html", () => {
    expect(htmlToMarkdown("")).toBeNull();
    expect(htmlToMarkdown("<p></p>")).toBeNull();
  });

  it.each([
    ["ordered-list-style numbers", "1. First 2. Second"],
    ["underscores in identifiers", "call snake_case_name here"],
    ["square brackets", "an array like arr[0] and [x]"],
    ["leading hash and dash", "# not a heading - not a bullet"],
  ])(
    "does not backslash-escape plain text (%s), so it defers to native paste",
    (_, text) => {
      // Plain punctuation must not be mangled into "1\\.", "snake\\_case", etc.
      // When it stays intact it equals the plain-text fallback and returns null.
      expect(htmlToMarkdown(`<span>${text}</span>`, text)).toBeNull();
    },
  );

  it("strips macOS <style> clipboard blocks instead of leaking CSS as text", () => {
    // Shape of the text/html macOS puts on the clipboard when copying rich
    // text from native apps. The CSS must not survive into the paste.
    const html = [
      '<meta charset="utf-8">',
      "<style>",
      "<!--",
      "p.p1 {margin: 0.0px 0.0px 0.0px 0.0px; font: 18.0px Helvetica}",
      "-->",
      "</style>",
      '<p class="p1">Yo dude</p>',
    ].join("\n");
    // No formatting beyond the plain text once the CSS is gone, so it defers.
    expect(htmlToMarkdown(html, "Yo dude")).toBeNull();
    expect(htmlToMarkdown(html)).toBe("Yo dude");
  });

  it("preserves real formatting without escaping surrounding punctuation", () => {
    const html = "<p>See <strong>item_1.</strong> in arr[0]</p>";
    expect(htmlToMarkdown(html, "See item_1. in arr[0]")).toBe(
      "See **item_1.** in arr[0]",
    );
  });
});

describe("isCodeEditorHtml", () => {
  // Shape of the text/html VS Code puts on the clipboard
  // (editor.copyWithSyntaxHighlighting): a white-space:pre wrapper with one
  // <div> per line of colored <span>s, <div><br/></div> for empty lines.
  const vsCode = (lines: string) =>
    `<meta charset='utf-8'><div style="color: #cccccc;background-color: #1f1f1f;font-family: Menlo, Monaco, 'Courier New', monospace;font-weight: normal;font-size: 12px;line-height: 18px;white-space: pre;">${lines}</div>`;

  it.each([
    [
      "a single-token VS Code copy",
      vsCode(
        '<div><span style="color: #4fc1ff;">SKILL_BUNDLE_MAX_FILES</span></div>',
      ),
    ],
    [
      "a multi-line VS Code copy with an empty line",
      vsCode(
        '<div><span style="color: #c586c0;">const</span><span style="color: #4fc1ff;"> A</span><span> = </span><span style="color: #b5cea8;">1</span></div><div><br/></div><div><span style="color: #c586c0;">const</span><span style="color: #4fc1ff;"> B</span><span> = </span><span style="color: #b5cea8;">2</span></div>',
      ),
    ],
    [
      "a bare <pre> copy (JetBrains-style)",
      '<pre style="background-color:#2b2b2b;color:#a9b7c6;"><span style="color:#cc7832;">const </span>SKILL_BUNDLE_MAX_FILES = <span style="color:#6897bb;">64</span></pre>',
    ],
  ])("matches %s", (_, html) => {
    expect(isCodeEditorHtml(html)).toBe(true);
  });

  it.each([
    [
      "a web code block, which converts to fenced Markdown",
      "<pre><code>const x = 1;</code></pre>",
    ],
    ["rich text", "<p>hello <strong>world</strong></p>"],
    [
      "preformatted text that still carries real formatting",
      '<div style="white-space: pre-wrap;">see <a href="https://posthog.com">docs</a></div>',
    ],
    [
      "multiple top-level blocks",
      '<div style="white-space: pre;">a</div><p>b</p>',
    ],
  ])("rejects %s", (_, html) => {
    expect(isCodeEditorHtml(html)).toBe(false);
  });

  it("exists because both paste conversions mangle the VS Code shape", () => {
    // Turndown turns the per-line <div>s into paragraphs, so the Markdown
    // gains a blank line between every code line and no longer matches the
    // clipboard's plain text ("const A = 1\nconst B = 2").
    const html = vsCode(
      "<div><span>const A = 1</span></div><div><span>const B = 2</span></div>",
    );
    expect(htmlToMarkdown(html, "const A = 1\nconst B = 2")).toBe(
      "const A = 1\n\nconst B = 2",
    );
    expect(isCodeEditorHtml(html)).toBe(true);
  });
});
