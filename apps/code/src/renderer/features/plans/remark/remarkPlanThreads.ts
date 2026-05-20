import type { Plugin } from "unified";

/**
 * Parses thread blockquotes (`> [H]: …` / `> [A]: …` / `> [resolved]`) inside
 * a plan markdown document and rewrites them into custom `<plan-thread>` HTML
 * nodes (consumed by `PlanView` via `componentsOverride`).
 *
 * Each non-thread top-level block (heading, paragraph, list item, code block)
 * is annotated with a `data-plan-block` attribute carrying the verbatim
 * source text of that block — the `PlanBlockGutter` reads it to send
 * `appendThreadMessage({ blockText, … })` to the main process, which uses
 * the snippet to locate the block on disk and insert the thread.
 */

interface MdNode {
  type: string;
  children?: MdNode[];
  value?: string;
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  } & Record<string, unknown>;
}

interface MdRoot extends MdNode {
  type: "root";
  children: MdNode[];
}

interface VFileLike {
  value?: string | Uint8Array;
}

const THREAD_LINE_RE = /^\s*\[(H|A|resolved)\](?::\s*(.*))?$/;

export interface ParsedThreadMessage {
  speaker: "H" | "A";
  text: string;
}

interface ParsedThread {
  messages: ParsedThreadMessage[];
  resolved: boolean;
}

function getNodeText(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  if (!node.children) return "";
  return node.children.map(getNodeText).join("");
}

function extractSource(node: MdNode, source: string): string | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return source.slice(start, end);
}

/**
 * Parses a blockquote node as a plan thread if it contains only `[H]`/`[A]`/
 * `[resolved]` lines. Returns `null` for blockquotes that are regular
 * markdown quotes.
 */
function parseThreadBlockquote(node: MdNode): ParsedThread | null {
  if (node.type !== "blockquote") return null;
  if (!node.children || node.children.length === 0) return null;

  const messages: ParsedThreadMessage[] = [];
  let resolved = false;

  for (const child of node.children) {
    if (child.type !== "paragraph") return null;
    const lines = getNodeText(child).split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const match = THREAD_LINE_RE.exec(line);
      if (!match) return null;
      const tag = match[1] as "H" | "A" | "resolved";
      if (tag === "resolved") {
        resolved = true;
      } else {
        messages.push({ speaker: tag, text: (match[2] ?? "").trim() });
      }
    }
  }

  if (messages.length === 0 && !resolved) return null;
  return { messages, resolved };
}

function asPlanThreadNode(
  thread: ParsedThread,
  anchor: MdNode,
  source: string,
): MdNode {
  const blockText = extractSource(anchor, source) ?? getNodeText(anchor);
  return {
    type: "planThread" as const,
    data: {
      hName: "plan-thread",
      hProperties: {
        "data-block-text": blockText,
        "data-messages": JSON.stringify(thread.messages),
        "data-resolved": thread.resolved ? "true" : "false",
      },
    },
  };
}

function annotateAnchorBlock(node: MdNode, source: string): void {
  const blockText = extractSource(node, source) ?? getNodeText(node);
  if (!blockText.trim()) return;
  if (!node.data) node.data = {};
  if (!node.data.hProperties) node.data.hProperties = {};
  const props = node.data.hProperties;
  if (!("data-plan-block" in props)) {
    props["data-plan-block"] = blockText;
  }
}

const ANCHORABLE_TYPES = new Set([
  "heading",
  "paragraph",
  "list",
  "code",
  "table",
]);

export const remarkPlanThreads: Plugin<[], MdRoot> = () => {
  return (tree, file) => {
    const source = String((file as VFileLike).value ?? "");
    const children = tree.children;

    for (let i = 0; i < children.length; i += 1) {
      const node = children[i];

      const thread = parseThreadBlockquote(node);
      if (thread) {
        // Find the nearest preceding non-thread sibling as the anchor.
        let anchorIndex = i - 1;
        while (
          anchorIndex >= 0 &&
          children[anchorIndex].type === "planThread"
        ) {
          anchorIndex -= 1;
        }
        const anchor = anchorIndex >= 0 ? children[anchorIndex] : node;
        children[i] = asPlanThreadNode(thread, anchor, source);
        continue;
      }

      if (ANCHORABLE_TYPES.has(node.type)) {
        annotateAnchorBlock(node, source);
      }
    }
  };
};
