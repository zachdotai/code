import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { injectable } from "inversify";

import type { ILogsService } from "./identifiers";

const DATA_DIR = ".posthog-code";

interface WriteState {
  pending: string | undefined;
  lastWritten: string | undefined;
  dirReady: boolean;
}

/**
 * Single-flight per `taskRunId` with latest-wins coalescing. Prevents the
 * gap-reconcile loop from spawning parallel writeFile of the same NDJSON.
 */
@injectable()
export class LocalLogsService implements ILogsService {
  private writes = new Map<
    string,
    { state: WriteState; inFlight: Promise<void> }
  >();

  async fetchS3Logs(logUrl: string): Promise<string | null> {
    try {
      const response = await fetch(logUrl);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        return null;
      }
      return await response.text();
    } catch {
      return null;
    }
  }

  async readLocalLogs(taskRunId: string): Promise<string | null> {
    const logPath = this.getLocalLogPath(taskRunId);
    try {
      return await fs.promises.readFile(logPath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      return null;
    }
  }

  /**
   * Read a window of the log ending at `endOffset` bytes (end of file when
   * `endOffset` is null), spanning at most `maxBytes`. Returns the whole ndjson
   * lines in that window plus the byte offset they start at, so a caller can
   * page backwards by passing the previous `startOffset` as the next
   * `endOffset`. `headReached` is true once the window reaches byte 0.
   *
   * A window that doesn't begin at byte 0 starts mid-line, so its first
   * (partial, possibly broken multi-byte) line is dropped; that line ends
   * exactly at the returned `startOffset`, so paging back includes it whole.
   */
  async readLocalLogsWindow(
    taskRunId: string,
    endOffset: number | null,
    maxBytes: number,
  ): Promise<{
    content: string;
    startOffset: number;
    endOffset: number;
    headReached: boolean;
  } | null> {
    const logPath = this.getLocalLogPath(taskRunId);
    try {
      const stat = await fs.promises.stat(logPath);
      const end = endOffset ?? stat.size;
      if (end <= 0) {
        return { content: "", startOffset: 0, endOffset: 0, headReached: true };
      }
      const rawStart = Math.max(0, end - maxBytes);
      const handle = await fs.promises.open(logPath, "r");
      try {
        if (rawStart === 0) {
          const buf = Buffer.alloc(end);
          const { bytesRead } = await handle.read(buf, 0, end, 0);
          return {
            content: buf.toString("utf-8", 0, bytesRead),
            startOffset: 0,
            endOffset: end,
            headReached: true,
          };
        }
        // Read one extra byte before the window: a newline there means the
        // window already starts on a whole line, so keep it. Otherwise the
        // first line is a fragment (and may start with a broken multi-byte
        // char) — drop everything up to the first newline. Either way the
        // returned startOffset is the byte the retained content begins at, so
        // paging back from it includes any dropped line whole.
        const length = end - rawStart;
        const buf = Buffer.alloc(length + 1);
        const { bytesRead } = await handle.read(
          buf,
          0,
          length + 1,
          rawStart - 1,
        );
        const raw = buf.toString("utf-8", 1, bytesRead);
        if (buf[0] === 0x0a) {
          return {
            content: raw,
            startOffset: rawStart,
            endOffset: end,
            headReached: false,
          };
        }
        const nl = raw.indexOf("\n");
        const dropped = nl >= 0 ? nl + 1 : raw.length;
        return {
          content: raw.slice(dropped),
          startOffset: rawStart + Buffer.byteLength(raw.slice(0, dropped)),
          endOffset: end,
          headReached: false,
        };
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }

  writeLocalLogs(taskRunId: string, content: string): Promise<void> {
    const existing = this.writes.get(taskRunId);
    if (existing) {
      existing.state.pending = content;
      return existing.inFlight;
    }

    const state: WriteState = {
      pending: undefined,
      lastWritten: undefined,
      dirReady: false,
    };
    const inFlight = this.drain(taskRunId, content, state);
    this.writes.set(taskRunId, { state, inFlight });
    return inFlight;
  }

  async seedLocalLogs(taskRunId: string, content: string): Promise<void> {
    if (!content?.trim()) return;
    const logPath = this.getLocalLogPath(taskRunId);
    const marker = JSON.stringify({ type: "seed_boundary" });
    const trailingNewline = content.endsWith("\n") ? "" : "\n";
    await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
    await fs.promises.writeFile(
      logPath,
      `${content}${trailingNewline}${marker}\n`,
      "utf-8",
    );
  }

  async countLocalLogEntries(taskRunId: string): Promise<number> {
    const logPath = this.getLocalLogPath(taskRunId);
    try {
      const content = await fs.promises.readFile(logPath, "utf-8");
      return content.split("\n").filter((line) => line.trim()).length;
    } catch {
      return 0;
    }
  }

  async deleteLocalLogCache(taskRunId: string): Promise<void> {
    const logPath = this.getLocalLogPath(taskRunId);
    await fs.promises.rm(logPath, { force: true });
  }

  private async drain(
    taskRunId: string,
    initialContent: string,
    state: WriteState,
  ): Promise<void> {
    try {
      let next: string | undefined = initialContent;
      while (next !== undefined) {
        const current = next;
        next = undefined;
        if (current !== state.lastWritten) {
          await this.doWrite(taskRunId, current, state);
          state.lastWritten = current;
        }
        if (state.pending !== undefined) {
          next = state.pending;
          state.pending = undefined;
        }
      }
    } finally {
      this.writes.delete(taskRunId);
    }
  }

  private async doWrite(
    taskRunId: string,
    content: string,
    state: WriteState,
  ): Promise<void> {
    const logPath = this.getLocalLogPath(taskRunId);
    try {
      if (!state.dirReady) {
        await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
        state.dirReady = true;
      }
      await fs.promises.writeFile(logPath, content, "utf-8");
    } catch {}
  }

  private getLocalLogPath(taskRunId: string): string {
    return path.join(
      os.homedir(),
      DATA_DIR,
      "sessions",
      taskRunId,
      "logs.ndjson",
    );
  }
}
