import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { buildNodeShimScript } from "@posthog/shared/node-shim";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findRealNode,
  MAX_PROBED_CANDIDATES,
  MIN_REAL_NODE_MAJOR,
  type RealNode,
} from "./real-node";

const dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "real-node-test-"));
  dirs.push(dir);
  return dir;
}

/** Writes an executable `node` fixture into a fresh dir and returns the dir. */
function makeBinDir(content: string): string {
  const dir = makeDir();
  const node = join(dir, "node");
  writeFileSync(node, content);
  chmodSync(node, 0o755);
  return dir;
}

function probeFixture(json: string, prelude = ""): string {
  return `#!/bin/sh\n${prelude}echo '${json}'\n`;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform === "win32")("findRealNode probing", () => {
  const EXEC_PATH = "/fake/app/binary";

  function findWithPath(pathDirs: string[], env: NodeJS.ProcessEnv = {}) {
    return findRealNode({
      env: { ...env, PATH: pathDirs.join(delimiter) },
      execPath: EXEC_PATH,
      platform: "darwin",
      probeTimeoutMs: 2000,
    });
  }

  it("accepts a candidate that identifies as a recent real node", async () => {
    const dir = makeBinDir(probeFixture('{"node":"v22.1.0","electron":null}'));
    await expect(findWithPath([dir])).resolves.toEqual({
      path: join(dir, "node"),
      version: "v22.1.0",
    });
  });

  it("tolerates version-manager noise before the JSON line", async () => {
    const dir = makeBinDir(
      probeFixture('{"node":"v24.2.0","electron":null}', "echo 'warn: xyz'\n"),
    );
    await expect(findWithPath([dir])).resolves.toEqual({
      path: join(dir, "node"),
      version: "v24.2.0",
    });
  });

  it("rejects a candidate that identifies as Electron", async () => {
    const dir = makeBinDir(
      probeFixture('{"node":"v22.1.0","electron":"37.2.0"}'),
    );
    await expect(findWithPath([dir])).resolves.toBeNull();
  });

  it("rejects a node older than the minimum major", async () => {
    const dir = makeBinDir(
      probeFixture(
        `{"node":"v${MIN_REAL_NODE_MAJOR - 2}.20.0","electron":null}`,
      ),
    );
    await expect(findWithPath([dir])).resolves.toBeNull();
  });

  it("rejects candidates that emit garbage or fail", async () => {
    const garbage = makeBinDir("#!/bin/sh\necho 'not json'\n");
    const failing = makeBinDir("#!/bin/sh\nexit 1\n");
    await expect(findWithPath([garbage, failing])).resolves.toBeNull();
  });

  it("kills and rejects a candidate that hangs", async () => {
    const dir = makeBinDir("#!/bin/sh\nsleep 30\n");
    await expect(
      findRealNode({
        env: { PATH: dir },
        execPath: EXEC_PATH,
        platform: "darwin",
        probeTimeoutMs: 300,
      }),
    ).resolves.toBeNull();
  });
});

describe("findRealNode PATH scanning", () => {
  function fakeExecPath(): string {
    const dir = makeDir();
    const execPath = join(dir, "app-binary");
    writeFileSync(execPath, "binary");
    return execPath;
  }

  function makeCandidateDir(): string {
    return makeBinDir("#!/bin/sh\nexit 0\n");
  }

  function scan(
    pathDirs: string[],
    probe: (candidatePath: string) => Promise<RealNode | null>,
    env: NodeJS.ProcessEnv = {},
    execPath = fakeExecPath(),
    warn?: (message: string, data?: Record<string, unknown>) => void,
  ) {
    return findRealNode({
      env: { ...env, PATH: pathDirs.join(delimiter) },
      execPath,
      platform: "darwin",
      probe,
      warn,
    });
  }

  it("returns the first candidate the probe accepts, in PATH order", async () => {
    const first = makeCandidateDir();
    const second = makeCandidateDir();
    const probe = vi.fn(async (candidatePath: string) =>
      candidatePath === join(second, "node")
        ? { path: candidatePath, version: "v22.0.0" }
        : null,
    );

    const result = await scan([first, "/does/not/exist", second], probe);

    expect(result).toEqual({ path: join(second, "node"), version: "v22.0.0" });
    expect(probe.mock.calls.map(([p]) => p)).toEqual([
      join(first, "node"),
      join(second, "node"),
    ]);
  });

  it("skips our own shim dirs without probing them", async () => {
    const execPath = fakeExecPath();
    const wrapperShim = makeDir();
    writeFileSync(join(wrapperShim, "node"), buildNodeShimScript(execPath));
    chmodSync(join(wrapperShim, "node"), 0o755);
    const realNodeWrapperShim = makeDir();
    writeFileSync(
      join(realNodeWrapperShim, "node"),
      buildNodeShimScript(execPath, "/usr/local/bin/node"),
    );
    chmodSync(join(realNodeWrapperShim, "node"), 0o755);
    const symlinkShim = makeDir();
    symlinkSync(execPath, join(symlinkShim, "node"));
    const probe = vi.fn(async () => null);

    await scan(
      [wrapperShim, realNodeWrapperShim, symlinkShim],
      probe,
      {},
      execPath,
    );

    expect(probe).not.toHaveBeenCalled();
  });

  it("prefers a valid POSTHOG_CODE_NODE_PATH override without scanning PATH", async () => {
    const onPath = makeCandidateDir();
    const probe = vi.fn(async (candidatePath: string) => ({
      path: candidatePath,
      version: "v22.0.0",
    }));

    const result = await scan([onPath], probe, {
      POSTHOG_CODE_NODE_PATH: "/custom/node",
    });

    expect(result).toEqual({ path: "/custom/node", version: "v22.0.0" });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("warns and gives up when the override does not validate", async () => {
    const onPath = makeCandidateDir();
    const probe = vi.fn(async () => null);
    const warn = vi.fn();

    const result = await scan(
      [onPath],
      probe,
      { POSTHOG_CODE_NODE_PATH: "/broken/node" },
      fakeExecPath(),
      warn,
    );

    expect(result).toBeNull();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      override: "/broken/node",
    });
  });

  it("stops probing after the candidate cap", async () => {
    const candidates = Array.from(
      { length: MAX_PROBED_CANDIDATES + 2 },
      makeCandidateDir,
    );
    const probe = vi.fn(async () => null);

    await expect(scan(candidates, probe)).resolves.toBeNull();
    expect(probe).toHaveBeenCalledTimes(MAX_PROBED_CANDIDATES);
  });

  it("returns null for an empty PATH", async () => {
    const probe = vi.fn(async () => null);
    await expect(scan([], probe)).resolves.toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });
});
