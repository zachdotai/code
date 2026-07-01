import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalLogsService } from "./service";

const RUN = "run-tail";

describe("LocalLogsService.readLocalLogsWindow", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "phlogs-"));
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    fs.mkdirSync(path.join(tmpHome, ".posthog-code", "sessions", RUN), {
      recursive: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  const logPath = () =>
    path.join(tmpHome, ".posthog-code", "sessions", RUN, "logs.ndjson");

  it("returns the whole file, head reached, when it fits in maxBytes", async () => {
    const content = "line1\nline2\nline3\n";
    fs.writeFileSync(logPath(), content);

    const res = await new LocalLogsService().readLocalLogsWindow(
      RUN,
      null,
      1_000_000,
    );

    expect(res).toEqual({
      content,
      startOffset: 0,
      endOffset: content.length,
      headReached: true,
    });
  });

  it("returns only the tail, dropping the partial first line, when over maxBytes", async () => {
    const lines = Array.from(
      { length: 1000 },
      (_, i) => `{"i":${i},"pad":"${"x".repeat(200)}"}`,
    );
    fs.writeFileSync(logPath(), `${lines.join("\n")}\n`);

    const res = await new LocalLogsService().readLocalLogsWindow(
      RUN,
      null,
      5000,
    );

    expect(res?.headReached).toBe(false);
    expect(res?.startOffset).toBeGreaterThan(0);
    const tailLines = res?.content.trim().split("\n") ?? [];
    for (const line of tailLines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(tailLines.at(-1)).toBe(lines.at(-1));
    expect(tailLines.length).toBeLessThan(lines.length);
  });

  it("pages backwards to reconstruct the whole file with no gap or duplicate", async () => {
    const lines = Array.from(
      { length: 500 },
      (_, i) => `{"i":${i},"pad":"${"y".repeat(120)}"}`,
    );
    fs.writeFileSync(logPath(), `${lines.join("\n")}\n`);
    const svc = new LocalLogsService();

    const collected: string[] = [];
    let endOffset: number | null = null;
    let headReached = false;
    while (!headReached) {
      const page = await svc.readLocalLogsWindow(RUN, endOffset, 3000);
      if (!page) break;
      const pageLines = page.content.trim()
        ? page.content.trim().split("\n")
        : [];
      collected.unshift(...pageLines);
      endOffset = page.startOffset;
      headReached = page.headReached;
    }

    expect(collected).toEqual(lines);
  });

  it("keeps the whole first line when the window starts on a line boundary", async () => {
    fs.writeFileSync(logPath(), "aaaa\nbbbb\ncccc\n");

    const res = await new LocalLogsService().readLocalLogsWindow(RUN, null, 10);

    expect(res).toEqual({
      content: "bbbb\ncccc\n",
      startOffset: 5,
      endOffset: 15,
      headReached: false,
    });
  });

  it("returns empty content when a single line exceeds maxBytes", async () => {
    fs.writeFileSync(logPath(), `{"pad":"${"x".repeat(500)}"}\n`);

    const res = await new LocalLogsService().readLocalLogsWindow(
      RUN,
      null,
      100,
    );

    expect(res?.content).toBe("");
    expect(res?.headReached).toBe(false);
  });

  it("returns null when the log doesn't exist", async () => {
    expect(
      await new LocalLogsService().readLocalLogsWindow("missing", null, 1000),
    ).toBeNull();
  });
});
