import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { remarkPlanThreads } from "./remarkPlanThreads";

interface HProps {
  "data-plan-block"?: string;
  "data-occurrence"?: string | number;
  "data-block-text"?: string;
  "data-messages"?: string;
  "data-resolved"?: string;
}

interface MdNode {
  type: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: HProps };
}

function parse(markdown: string): MdNode {
  const processor = unified().use(remarkParse).use(remarkPlanThreads);
  const tree = processor.parse(markdown);
  // Pass the source string as the second arg so the plugin can read
  // `file.value` and recover the verbatim text of each block via offsets.
  // The cast through `unknown` bridges remark's strict mdast `RootContent`
  // types and our loose `MdNode` shape used by the plugin.
  return processor.runSync(tree, markdown) as unknown as MdNode;
}

function getTopChildren(tree: MdNode): MdNode[] {
  return tree.children ?? [];
}

describe("remarkPlanThreads", () => {
  it("annotates anchorable blocks with their source text", () => {
    const tree = parse(`## Heading\n\nA paragraph of text.\n\n- list item\n`);
    const children = getTopChildren(tree);
    expect(children).toHaveLength(3);
    expect(children[0].data?.hProperties?.["data-plan-block"]).toBe(
      "## Heading",
    );
    expect(children[1].data?.hProperties?.["data-plan-block"]).toBe(
      "A paragraph of text.",
    );
    expect(children[2].data?.hProperties?.["data-plan-block"]).toBe(
      "- list item",
    );
  });

  it("assigns a 0-based occurrence index per identical block", () => {
    const tree = parse(
      [
        "## Step 1",
        "",
        "first content",
        "",
        "## Step 1",
        "",
        "second content",
        "",
        "## Step 1",
        "",
        "third content",
      ].join("\n"),
    );
    const children = getTopChildren(tree);
    const headings = children.filter((c) => c.type === "heading");
    expect(headings).toHaveLength(3);
    expect(headings[0].data?.hProperties?.["data-occurrence"]).toBe(0);
    expect(headings[1].data?.hProperties?.["data-occurrence"]).toBe(1);
    expect(headings[2].data?.hProperties?.["data-occurrence"]).toBe(2);
  });

  it("rewrites blockquote threads into plan-thread nodes", () => {
    const tree = parse(
      [
        "## Step 1",
        "",
        "Move stuff.",
        "",
        "> [H]: why?",
        "> [A]: because.",
      ].join("\n"),
    );
    const threadNodes = getTopChildren(tree).filter(
      (c) => c.type === "planThread",
    );
    expect(threadNodes).toHaveLength(1);
    const props = threadNodes[0].data?.hProperties;
    expect(props?.["data-block-text"]).toBe("Move stuff.");
    expect(props?.["data-resolved"]).toBe("false");
    expect(JSON.parse(props?.["data-messages"] ?? "[]")).toEqual([
      { speaker: "H", text: "why?" },
      { speaker: "A", text: "because." },
    ]);
  });

  it("marks a thread as resolved when it ends with [resolved]", () => {
    const tree = parse(
      [
        "Move stuff.",
        "",
        "> [H]: why?",
        "> [A]: because.",
        "> [resolved]",
      ].join("\n"),
    );
    const threadNodes = getTopChildren(tree).filter(
      (c) => c.type === "planThread",
    );
    expect(threadNodes[0].data?.hProperties?.["data-resolved"]).toBe("true");
  });

  it("propagates the anchor block's occurrence to its thread", () => {
    const tree = parse(
      ["## Step", "", "## Step", "", "> [H]: which one are you on?"].join("\n"),
    );
    const threadNodes = getTopChildren(tree).filter(
      (c) => c.type === "planThread",
    );
    expect(threadNodes).toHaveLength(1);
    // The thread anchors to the SECOND `## Step`, so its occurrence is 1.
    expect(threadNodes[0].data?.hProperties?.["data-occurrence"]).toBe(1);
  });

  it("leaves non-thread blockquotes untouched", () => {
    const tree = parse(
      ["A paragraph.", "", "> A regular quote, not a thread."].join("\n"),
    );
    const children = getTopChildren(tree);
    expect(children.find((c) => c.type === "planThread")).toBeUndefined();
    expect(children.find((c) => c.type === "blockquote")).toBeDefined();
  });

  it("parses a thread even when CommonMark sees mixed definition + linkReference nodes", () => {
    // The bug: once `[H]: Why?` parses as a link reference definition,
    // any subsequent `[H]` in the file (including inside the same
    // blockquote) becomes a `linkReference` node that "consumes" the
    // brackets, leaving raw text like `H: Got it.` after reconstruction.
    // The parser must work directly off the source slice to survive
    // this — not off the mdast children.
    const tree = parse(
      [
        "Anchor.",
        "",
        "> [H]: Why?",
        "> [A]: Because Z.",
        "> [H]: Got it.",
      ].join("\n"),
    );
    const threadNodes = getTopChildren(tree).filter(
      (c) => c.type === "planThread",
    );
    expect(threadNodes).toHaveLength(1);
    const props = threadNodes[0].data?.hProperties;
    expect(JSON.parse(props?.["data-messages"] ?? "[]")).toEqual([
      { speaker: "H", text: "Why?" },
      { speaker: "A", text: "Because Z." },
      { speaker: "H", text: "Got it." },
    ]);
  });

  it("parses a thread of two single-word messages (consecutive definitions)", () => {
    // Each line parses as its own `definition` node; the parser must
    // accept both definition children AND survive the source-based
    // reconstruction.
    const tree = parse(
      ["Anchor.", "", "> [H]: question", "> [H]: followup"].join("\n"),
    );
    const threadNodes = getTopChildren(tree).filter(
      (c) => c.type === "planThread",
    );
    expect(threadNodes).toHaveLength(1);
    expect(
      JSON.parse(threadNodes[0].data?.hProperties?.["data-messages"] ?? "[]"),
    ).toEqual([
      { speaker: "H", text: "question" },
      { speaker: "H", text: "followup" },
    ]);
  });

  it("does NOT annotate `code` or `table` blocks (UI surfaces no gutter for them)", () => {
    // mdast-util-to-hast moves a fenced `code` node's hProperties onto the
    // inner `<code>` element (wrapped in `<pre>`), and the base `table`
    // component drops arbitrary props. Until we wrap those components
    // properly, marking them anchorable just confuses users — clicking
    // the gutter would fail. Limit the anchor surface to blocks the
    // renderer actually wraps with `PlanBlockGutter`.
    const source = [
      "Paragraph.",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const tree = parse(source);
    const children = getTopChildren(tree);
    const code = children.find((c) => c.type === "code");
    expect(code?.data?.hProperties?.["data-plan-block"]).toBeUndefined();
    // Tables only appear with remark-gfm; with plain remark-parse this
    // shape parses as a paragraph (and gets annotated as a paragraph).
    // Confirm no node ever carries `data-plan-block` on a `table` node:
    const table = children.find((c) => c.type === "table");
    if (table) {
      expect(table.data?.hProperties?.["data-plan-block"]).toBeUndefined();
    }
  });
});
