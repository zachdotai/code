import * as fs from "node:fs/promises";
import * as path from "node:path";

export type MemoryType =
  | "person"
  | "context"
  | "glossary"
  | "project"
  | "preference"
  | "reference"
  | "feedback"
  | string;

export interface MemoryFrontmatter {
  name: string;
  description: string;
  type: MemoryType;
  sync?: { source: string; cron: string };
}

export interface MemoryEntry {
  relativePath: string;
  absolutePath: string;
  name: string;
  description: string;
  type: MemoryType;
  /** File modification time in ms since epoch. */
  mtimeMs: number;
  sync?: { source: string; cron: string };
}

export interface MemoryGraphNode {
  id: string;
  label: string;
  type: MemoryType;
}

export interface MemoryGraphEdge {
  source: string;
  target: string;
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
}

export function parseMemoryFrontmatter(content: string): MemoryFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { name: "", description: "", type: "context" };
  }

  const yaml = match[1];
  const name = extractValue(yaml, "name") ?? "";
  const description = extractValue(yaml, "description") ?? "";
  const type = (extractValue(yaml, "type") ?? "context") as MemoryType;

  let sync: MemoryFrontmatter["sync"] | undefined;
  const syncSource = extractNestedValue(yaml, "sync", "source");
  const syncCron = extractNestedValue(yaml, "sync", "cron");
  if (syncSource && syncCron) {
    sync = { source: syncSource, cron: syncCron };
  }

  return { name, description, type, sync };
}

function extractValue(yaml: string, key: string): string | null {
  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!match) continue;
    const raw = match[1].trim();
    if (raw === ">-" || raw === ">")
      return collectIndented(lines, i + 1).join(" ");
    if (raw === "|-" || raw === "|")
      return collectIndented(lines, i + 1).join("\n");
    if (
      (raw.startsWith("'") && raw.endsWith("'")) ||
      (raw.startsWith('"') && raw.endsWith('"'))
    ) {
      return raw.slice(1, -1);
    }
    return raw || null;
  }
  return null;
}

function extractNestedValue(
  yaml: string,
  parent: string,
  child: string,
): string | null {
  const lines = yaml.split("\n");
  let inParent = false;
  for (const line of lines) {
    if (line.match(new RegExp(`^${parent}:\\s*$`))) {
      inParent = true;
      continue;
    }
    if (inParent) {
      if (!line.match(/^\s/)) break;
      const match = line.match(new RegExp(`^\\s+${child}:\\s*(.+)$`));
      if (match) {
        const raw = match[1].trim();
        if (
          (raw.startsWith('"') && raw.endsWith('"')) ||
          (raw.startsWith("'") && raw.endsWith("'"))
        ) {
          return raw.slice(1, -1);
        }
        return raw;
      }
    }
  }
  return null;
}

function collectIndented(lines: string[], start: number): string[] {
  const result: string[] = [];
  for (let i = start; i < lines.length; i++) {
    if (lines[i].match(/^\s+\S/)) result.push(lines[i].trim());
    else break;
  }
  return result;
}

export function extractMarkdownLinks(
  content: string,
  relativePath: string,
): string[] {
  const dir = path.dirname(relativePath);
  const targets: string[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  for (;;) {
    const match = linkRegex.exec(content);
    if (match === null) break;
    const href = match[2];
    if (href.startsWith("http") || href.startsWith("#")) continue;
    if (!href.endsWith(".md")) continue;
    const resolved = path.normalize(path.join(dir, href));
    targets.push(resolved);
  }
  return targets;
}

export async function listMemoryFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  await walk(root, root, results);
  return results;
}

async function walk(
  root: string,
  dir: string,
  results: string[],
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = (await fs.readdir(dir, {
      withFileTypes: true,
    })) as import("node:fs").Dirent[];
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = String(entry.name);
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (entry.isDirectory()) {
      await walk(root, full, results);
    } else if (entry.isFile() && name.endsWith(".md")) {
      results.push(path.relative(root, full));
    }
  }
}
