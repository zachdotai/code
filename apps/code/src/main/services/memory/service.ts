import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as watcher from "@parcel/watcher";
import { injectable } from "inversify";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import {
  extractMarkdownLinks,
  listMemoryFiles,
  type MemoryEntry,
  type MemoryGraph,
  type MemoryType,
  parseMemoryFrontmatter,
} from "./parser";

const log = logger.scope("memory-service");

export const MEMORY_ROOT_ENV = "POSTHOG_MEMORY_DIR";
const DEFAULT_MEMORY_ROOT = path.join(os.homedir(), ".claude", "memory");

export enum MemoryServiceEvent {
  Changed = "memory:changed",
}

export interface MemoryChangedPayload {
  relativePath: string;
  changeType: "created" | "modified" | "deleted";
}

export interface MemoryServiceEvents {
  [MemoryServiceEvent.Changed]: MemoryChangedPayload;
}

@injectable()
export class MemoryService extends TypedEventEmitter<MemoryServiceEvents> {
  private watchSub: watcher.AsyncSubscription | null = null;
  private _root: string | null = null;

  getRoot(): string {
    if (!this._root) {
      this._root = process.env[MEMORY_ROOT_ENV] ?? DEFAULT_MEMORY_ROOT;
    }
    return this._root;
  }

  setRoot(newRoot: string): void {
    this._root = newRoot;
    this.restartWatcher().catch((err) =>
      log.warn("Failed to restart watcher after root change", err),
    );
  }

  async ensureDir(): Promise<void> {
    const root = this.getRoot();
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(path.join(root, "people"), { recursive: true });
    await fs.mkdir(path.join(root, "context"), { recursive: true });

    const indexPath = path.join(root, "MEMORY.md");
    if (!fsSync.existsSync(indexPath)) {
      await fs.writeFile(indexPath, STARTER_MEMORY_MD, "utf-8");
    }
  }

  async startWatcher(): Promise<void> {
    const root = this.getRoot();
    if (!fsSync.existsSync(root)) {
      await this.ensureDir();
    }

    try {
      this.watchSub = await watcher.subscribe(root, (err, events) => {
        if (err) {
          log.warn("Memory watcher error", err);
          return;
        }
        for (const event of events) {
          if (!event.path.endsWith(".md")) continue;
          const relativePath = path.relative(root, event.path);
          const changeType =
            event.type === "delete"
              ? "deleted"
              : fsSync.existsSync(event.path)
                ? "modified"
                : "deleted";
          this.emit(MemoryServiceEvent.Changed, { relativePath, changeType });
        }
      });
    } catch (err) {
      log.warn("Failed to start memory file watcher", err);
    }
  }

  async stopWatcher(): Promise<void> {
    if (this.watchSub) {
      await this.watchSub.unsubscribe();
      this.watchSub = null;
    }
  }

  private async restartWatcher(): Promise<void> {
    await this.stopWatcher();
    await this.startWatcher();
  }

  async list(): Promise<MemoryEntry[]> {
    const root = this.getRoot();
    let relativePaths: string[];
    try {
      relativePaths = await listMemoryFiles(root);
    } catch {
      return [];
    }

    const entries = await Promise.all(
      relativePaths.map(async (rel): Promise<MemoryEntry | null> => {
        try {
          const abs = path.join(root, rel);
          const [content, stat] = await Promise.all([
            fs.readFile(abs, "utf-8"),
            fs.stat(abs),
          ]);
          const fm = parseMemoryFrontmatter(content);
          const name = fm.name || path.basename(rel, ".md").replace(/-/g, " ");
          const entry: MemoryEntry = {
            relativePath: rel,
            absolutePath: abs,
            name,
            description: fm.description,
            type: fm.type,
            mtimeMs: stat.mtimeMs,
          };
          if (fm.sync) entry.sync = fm.sync;
          return entry;
        } catch {
          return null;
        }
      }),
    );
    return entries.filter((e): e is MemoryEntry => e !== null);
  }

  async get(relativePath: string): Promise<string> {
    const abs = this.resolve(relativePath);
    return fs.readFile(abs, "utf-8");
  }

  async write(relativePath: string, content: string): Promise<void> {
    const abs = this.resolve(relativePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
  }

  async create(name: string, type: MemoryType): Promise<string> {
    const slug = name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const folder = typeToFolder(type);
    const relativePath = folder ? `${folder}/${slug}.md` : `${slug}.md`;
    const abs = this.resolve(relativePath);

    if (fsSync.existsSync(abs)) {
      throw new Error(`Memory entry already exists: ${relativePath}`);
    }

    const content = `---\nname: ${name}\ndescription: \ntype: ${type}\n---\n\n# ${name}\n`;
    await this.write(relativePath, content);
    return relativePath;
  }

  async delete(relativePath: string): Promise<void> {
    const abs = this.resolve(relativePath);
    await fs.unlink(abs);
  }

  async clearAll(): Promise<void> {
    const root = this.getRoot();
    const files = await listMemoryFiles(root);
    await Promise.all(
      files.map(async (rel) => {
        try {
          await fs.unlink(path.join(root, rel));
        } catch {
          // ignore missing files
        }
      }),
    );
    await this.ensureDir();
  }

  async getGraph(): Promise<MemoryGraph> {
    const root = this.getRoot();
    const entries = await this.list();
    const nodeMap = new Map<string, MemoryEntry>();
    for (const e of entries) {
      nodeMap.set(e.relativePath, e);
    }

    const nodes = entries.map((e) => ({
      id: e.relativePath,
      label: e.name,
      type: e.type,
    }));

    const edges: MemoryGraph["edges"] = [];
    const edgeSet = new Set<string>();

    await Promise.all(
      entries.map(async (e) => {
        try {
          const content = await fs.readFile(
            path.join(root, e.relativePath),
            "utf-8",
          );
          const targets = extractMarkdownLinks(content, e.relativePath);
          for (const target of targets) {
            if (nodeMap.has(target) && target !== e.relativePath) {
              const key = [e.relativePath, target].sort().join("||");
              if (!edgeSet.has(key)) {
                edgeSet.add(key);
                edges.push({ source: e.relativePath, target });
              }
            }
          }
        } catch {
          // skip unreadable files
        }
      }),
    );

    return { nodes, edges };
  }

  private resolve(relativePath: string): string {
    const root = this.getRoot();
    const abs = path.resolve(root, relativePath);
    if (!abs.startsWith(root)) {
      throw new Error("Path traversal not allowed");
    }
    return abs;
  }
}

function typeToFolder(type: MemoryType): string | null {
  if (type === "person") return "people";
  if (type === "context" || type === "project" || type === "reference")
    return "context";
  return null;
}

const STARTER_MEMORY_MD = `---
name: Memory Index
description: Personal memory index — who I am, what I'm working on, who I work with
type: context
---

# Memory

## Me

<!-- Add your name, role, and a one-line bio here -->

## People

<!-- Add key people you work with. Create individual files in people/ for each person. -->

## Current Focus

<!-- What are you working on right now? -->

## Preferences

<!-- Working style, communication preferences, time zones, etc. -->

## Memory Map

- [people/](people/) — one file per person you work with
- [context/](context/) — company details, projects, responsibilities
`;
