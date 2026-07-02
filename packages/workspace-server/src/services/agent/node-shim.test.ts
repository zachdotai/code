import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildNodeShimScript, ensureNodeShim } from "./node-shim";

const APP_PATH = "/Applications/PostHog Code.app/Contents/MacOS/PostHog Code";
const VENDORED_NODE = "/Applications/PostHog Code.app/vendored/node";

describe("ensureNodeShim", () => {
  const dirs: string[] = [];

  function makeDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "node-shim-test-"));
    dirs.push(dir);
    return join(dir, "shim");
  }

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("symlinks to the vendored node runtime when available", () => {
    const dir = makeDir();
    ensureNodeShim(dir, APP_PATH, {
      vendoredNodePath: VENDORED_NODE,
      platform: "darwin",
    });

    const shim = join(dir, "node");
    expect(lstatSync(shim).isSymbolicLink()).toBe(true);
    expect(readlinkSync(shim)).toBe(VENDORED_NODE);
  });

  it("upgrades a fallback wrapper to the vendored symlink", () => {
    const dir = makeDir();
    ensureNodeShim(dir, APP_PATH, { platform: "darwin" });

    ensureNodeShim(dir, APP_PATH, {
      vendoredNodePath: VENDORED_NODE,
      platform: "darwin",
    });

    const shim = join(dir, "node");
    expect(lstatSync(shim).isSymbolicLink()).toBe(true);
    expect(readlinkSync(shim)).toBe(VENDORED_NODE);
  });

  it("retargets the symlink when the vendored path changes", () => {
    const dir = makeDir();
    ensureNodeShim(dir, APP_PATH, {
      vendoredNodePath: "/old/vendored/node",
      platform: "darwin",
    });

    ensureNodeShim(dir, APP_PATH, {
      vendoredNodePath: VENDORED_NODE,
      platform: "darwin",
    });

    expect(readlinkSync(join(dir, "node"))).toBe(VENDORED_NODE);
  });

  it("writes an executable run-as-node wrapper when no vendored runtime exists", () => {
    const dir = makeDir();
    ensureNodeShim(dir, APP_PATH, { platform: "darwin" });

    const shim = join(dir, "node");
    const content = readFileSync(shim, "utf-8");
    expect(content).toContain("#!/bin/sh");
    expect(content).toContain("export ELECTRON_RUN_AS_NODE=1");
    expect(content).toContain(`exec "${APP_PATH}" "$@"`);
    expect(statSync(shim).mode & 0o111).not.toBe(0);
  });

  it("escapes shell-special characters in the fallback wrapper", () => {
    expect(buildNodeShimScript('/odd/pa"th/$app`bin\\x')).toContain(
      'exec "/odd/pa\\"th/\\$app\\`bin\\\\x" "$@"',
    );
  });

  it("replaces a legacy symlink to the app binary with the wrapper", () => {
    const dir = makeDir();
    ensureNodeShim(dir, APP_PATH, { platform: "darwin" });
    const shim = join(dir, "node");
    rmSync(shim);
    symlinkSync(APP_PATH, shim);

    ensureNodeShim(dir, APP_PATH, { platform: "darwin" });

    expect(lstatSync(shim).isSymbolicLink()).toBe(false);
    expect(readFileSync(shim, "utf-8")).toBe(buildNodeShimScript(APP_PATH));
  });

  it("rewrites the wrapper when the app binary path changes", () => {
    const dir = makeDir();
    ensureNodeShim(dir, "/old/location/App", { platform: "darwin" });

    ensureNodeShim(dir, APP_PATH, { platform: "darwin" });

    expect(readFileSync(join(dir, "node"), "utf-8")).toBe(
      buildNodeShimScript(APP_PATH),
    );
  });

  it("leaves an up-to-date wrapper untouched", () => {
    const dir = makeDir();
    ensureNodeShim(dir, APP_PATH, { platform: "darwin" });
    const shim = join(dir, "node");
    const past = new Date("2020-01-01T00:00:00Z");
    utimesSync(shim, past, past);

    ensureNodeShim(dir, APP_PATH, { platform: "darwin" });

    expect(statSync(shim).mtimeMs).toBe(past.getTime());
  });

  it("replaces a corrupt shim that is not the expected script", () => {
    const dir = makeDir();
    ensureNodeShim(dir, APP_PATH, { platform: "darwin" });
    const shim = join(dir, "node");
    writeFileSync(shim, "not a shim");

    ensureNodeShim(dir, APP_PATH, { platform: "darwin" });

    expect(readFileSync(shim, "utf-8")).toBe(buildNodeShimScript(APP_PATH));
  });

  it("writes a node.cmd shim on windows when a vendored runtime exists", () => {
    const dir = makeDir();
    ensureNodeShim(dir, APP_PATH, { platform: "win32" });

    ensureNodeShim(dir, APP_PATH, {
      vendoredNodePath: "C:\\App\\vendored\\node.exe",
      platform: "win32",
    });

    const cmd = readFileSync(join(dir, "node.cmd"), "utf-8");
    expect(cmd).toContain('"C:\\App\\vendored\\node.exe" %*');
    expect(existsSync(join(dir, "node"))).toBe(false);
  });

  it("removes a stale node.cmd when downgrading to the fallback on windows", () => {
    const dir = makeDir();
    ensureNodeShim(dir, APP_PATH, {
      vendoredNodePath: "C:\\App\\vendored\\node.exe",
      platform: "win32",
    });

    ensureNodeShim(dir, APP_PATH, { platform: "win32" });

    expect(existsSync(join(dir, "node.cmd"))).toBe(false);
    expect(lstatSync(join(dir, "node")).isSymbolicLink()).toBe(true);
  });

  it("keeps the symlink behavior on windows without a vendored runtime", () => {
    const dir = makeDir();
    ensureNodeShim(dir, APP_PATH, { platform: "win32" });
    ensureNodeShim(dir, APP_PATH, { platform: "win32" });

    const shim = join(dir, "node");
    expect(lstatSync(shim).isSymbolicLink()).toBe(true);
    expect(readlinkSync(shim)).toBe(APP_PATH);
  });
});
