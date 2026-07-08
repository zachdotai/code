import { describe, expect, it } from "vitest";
import { buildNodeShimScript, isNodeShimScript } from "./node-shim";

const EXEC_PATH = "/Applications/PostHog Code.app/Contents/MacOS/PostHog Code";

describe("buildNodeShimScript", () => {
  it("sets ELECTRON_RUN_AS_NODE and execs the binary", () => {
    const script = buildNodeShimScript(EXEC_PATH);
    expect(script).toContain("#!/bin/sh");
    expect(script).toContain("export ELECTRON_RUN_AS_NODE=1");
    expect(script).toContain(`exec "${EXEC_PATH}" "$@"`);
  });

  it("prefers the real node when given one, keeping the run-as-node fallback", () => {
    const script = buildNodeShimScript(EXEC_PATH, "/usr/local/bin/node");
    const lines = script.split("\n");
    expect(lines[0]).toBe("#!/bin/sh");
    expect(lines[1]).toBe('if [ -x "/usr/local/bin/node" ]; then');
    expect(lines[2]).toBe('  exec "/usr/local/bin/node" "$@"');
    expect(lines[3]).toBe("fi");
    expect(script).toContain("export ELECTRON_RUN_AS_NODE=1");
    expect(script).toContain(`exec "${EXEC_PATH}" "$@"`);
  });

  it("escapes shell-special characters in both paths", () => {
    expect(buildNodeShimScript('/odd/pa"th/$app`bin\\x')).toContain(
      'exec "/odd/pa\\"th/\\$app\\`bin\\\\x" "$@"',
    );
    expect(buildNodeShimScript(EXEC_PATH, '/odd/no"de/$v')).toContain(
      'exec "/odd/no\\"de/\\$v" "$@"',
    );
  });
});

describe("isNodeShimScript", () => {
  it("recognizes both variants written for the same binary", () => {
    expect(isNodeShimScript(buildNodeShimScript(EXEC_PATH), EXEC_PATH)).toBe(
      true,
    );
    expect(
      isNodeShimScript(
        buildNodeShimScript(EXEC_PATH, "/usr/local/bin/node"),
        EXEC_PATH,
      ),
    ).toBe(true);
  });

  it("rejects shims written for a different binary and non-shim content", () => {
    expect(
      isNodeShimScript(buildNodeShimScript("/some/other/app"), EXEC_PATH),
    ).toBe(false);
    expect(
      isNodeShimScript(
        buildNodeShimScript("/some/other/app", "/usr/local/bin/node"),
        EXEC_PATH,
      ),
    ).toBe(false);
    expect(isNodeShimScript("not a shim", EXEC_PATH)).toBe(false);
    expect(isNodeShimScript("", EXEC_PATH)).toBe(false);
  });
});
