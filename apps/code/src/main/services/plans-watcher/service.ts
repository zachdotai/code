import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as watcher from "@parcel/watcher";
import { inject, injectable, preDestroy } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { WatcherRegistryService } from "../watcher-registry/service";
import {
  type PlanAppendInput,
  type PlanResolveInput,
  PlansWatcherEvent,
  type PlansWatcherEvents,
  type Speaker,
} from "./schemas";

const log = logger.scope("plans-watcher");
const DEBOUNCE_MS = 100;
const WATCHER_ID = "plans-watcher:plans-dir";

/** Mirrors `getClaudePlansDir` in @posthog/agent — kept local to avoid a new subpath export. */
function getClaudePlansDir(): string {
  const configDir =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return path.join(configDir, "plans");
}

/**
 * A thread is a contiguous markdown blockquote of lines like
 * `> [H]: …`, `> [A]: …`, or `> [resolved]` placed immediately after the
 * block it is anchored to (the user clicked `+` on the preceding paragraph
 * / heading / list item). We never need to identify a thread by an opaque
 * id — its anchor is the preceding block, located via verbatim text match.
 */
const THREAD_LINE_RE = /^\s*>\s*\[(H|A|resolved)\](?::\s*(.*))?$/;

export function isThreadLine(line: string): boolean {
  return THREAD_LINE_RE.test(line);
}

export function findBlockInsertionLine(
  lines: string[],
  blockText: string,
): number | null {
  const trimmed = blockText.trim();
  if (!trimmed) return null;

  // Try to match as a contiguous run of source lines that fully contains the
  // user-supplied text. Walk the file line by line and check whether a
  // window starting at each line — joined by newlines — contains `trimmed`
  // as a substring.
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    let acc = lines[i];
    let j = i;
    while (j < lines.length - 1 && !acc.includes(trimmed)) {
      j += 1;
      acc = `${acc}\n${lines[j]}`;
      if (acc.length > trimmed.length + 400) break;
    }
    if (acc.includes(trimmed)) {
      // The block ends on line `j`. Insertion point is `j + 1` (the line
      // after the matched block).
      return j + 1;
    }
  }
  return null;
}

export function findExistingThreadRange(
  lines: string[],
  startLine: number,
): { start: number; end: number } | null {
  // Skip blank lines immediately after the anchor block.
  let cursor = startLine;
  while (cursor < lines.length && lines[cursor].trim() === "") cursor += 1;
  if (cursor >= lines.length || !isThreadLine(lines[cursor])) return null;

  const threadStart = cursor;
  while (cursor < lines.length && isThreadLine(lines[cursor])) cursor += 1;
  return { start: threadStart, end: cursor };
}

export function formatThreadLine(speaker: Speaker, message: string): string {
  // Collapse newlines so the message lives in a single blockquote line — the
  // agent and parser both expect one line per message.
  const oneLine = message.replace(/\s+/g, " ").trim();
  return `> [${speaker}]: ${oneLine}`;
}

@injectable()
export class PlansWatcherService extends TypedEventEmitter<PlansWatcherEvents> {
  private started = false;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @inject(MAIN_TOKENS.WatcherRegistryService)
    private watcherRegistry: WatcherRegistryService,
  ) {
    super();
  }

  @preDestroy()
  async destroy(): Promise<void> {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    await this.stop();
  }

  /** Idempotent — starts watching the plans directory if not already. */
  async ensureStarted(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const plansDir = getClaudePlansDir();
    try {
      await fs.mkdir(plansDir, { recursive: true });
    } catch (err) {
      log.warn(`Failed to ensure plans dir exists at ${plansDir}:`, err);
    }

    try {
      const subscription = await watcher.subscribe(plansDir, (err, events) => {
        if (this.watcherRegistry.isShutdown) return;
        if (err) {
          log.warn("Plans watcher error:", err);
          return;
        }
        for (const event of events) {
          this.queueEvent(event);
        }
      });
      this.watcherRegistry.register(WATCHER_ID, subscription);
      log.info(`Watching plans dir: ${plansDir}`);
    } catch (err) {
      log.error(`Failed to start plans watcher at ${plansDir}:`, err);
      this.started = false;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.watcherRegistry.unregister(WATCHER_ID);
  }

  async readPlan(filePath: string): Promise<string | null> {
    if (!this.isPlanFilePath(filePath)) {
      throw new Error(`Refusing to read non-plan file: ${filePath}`);
    }
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw err;
    }
  }

  async appendThreadMessage(input: PlanAppendInput): Promise<void> {
    if (!this.isPlanFilePath(input.filePath)) {
      throw new Error(`Refusing to write non-plan file: ${input.filePath}`);
    }
    const original = (await this.readPlan(input.filePath)) ?? "";
    const lines = original.split("\n");
    const insertionLine = findBlockInsertionLine(lines, input.blockText);
    if (insertionLine === null) {
      throw new Error("Plan thread anchor block not found in file");
    }

    const newLine = formatThreadLine(input.speaker, input.message);
    const existing = findExistingThreadRange(lines, insertionLine);

    let next: string[];
    if (existing) {
      // Extend the existing thread. If the last line is `> [resolved]`, insert
      // before it so the resolved marker stays terminal.
      const insertAt =
        lines[existing.end - 1]?.trim() === "> [resolved]"
          ? existing.end - 1
          : existing.end;
      next = [...lines.slice(0, insertAt), newLine, ...lines.slice(insertAt)];
    } else {
      // Create a new thread immediately after the anchor block. Ensure there
      // is exactly one blank line between the block and the thread.
      const prefix = lines.slice(0, insertionLine);
      const suffix = lines.slice(insertionLine);
      const needsBlank = prefix.length > 0 && prefix[prefix.length - 1] !== "";
      next = [...prefix, ...(needsBlank ? [""] : []), newLine, ...suffix];
    }

    await this.atomicWrite(input.filePath, next.join("\n"));
  }

  async resolveThread(input: PlanResolveInput): Promise<void> {
    if (!this.isPlanFilePath(input.filePath)) {
      throw new Error(`Refusing to write non-plan file: ${input.filePath}`);
    }
    const original = (await this.readPlan(input.filePath)) ?? "";
    const lines = original.split("\n");
    const insertionLine = findBlockInsertionLine(lines, input.blockText);
    if (insertionLine === null) {
      throw new Error("Plan thread anchor block not found in file");
    }

    const existing = findExistingThreadRange(lines, insertionLine);
    if (!existing) {
      throw new Error("No thread to resolve under that block");
    }
    if (lines[existing.end - 1]?.trim() === "> [resolved]") {
      return; // already resolved
    }

    const next = [
      ...lines.slice(0, existing.end),
      "> [resolved]",
      ...lines.slice(existing.end),
    ];
    await this.atomicWrite(input.filePath, next.join("\n"));
  }

  private isPlanFilePath(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    const plansDir = path.resolve(getClaudePlansDir());
    return resolved.startsWith(plansDir + path.sep) && resolved.endsWith(".md");
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, filePath);
  }

  private queueEvent(event: watcher.Event): void {
    if (!event.path.endsWith(".md")) return;

    const key = event.path;
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        if (event.type === "delete") {
          this.emit(PlansWatcherEvent.PlanFileDeleted, {
            filePath: event.path,
          });
        } else {
          this.emit(PlansWatcherEvent.PlanFileChanged, {
            filePath: event.path,
          });
        }
      }, DEBOUNCE_MS),
    );
  }
}
