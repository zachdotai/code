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
  it.each([
    {
      content: "fallback-only shim for the binary",
      script: buildNodeShimScript(EXEC_PATH),
      expected: true,
    },
    {
      content: "real-node-preferring shim for the binary",
      script: buildNodeShimScript(EXEC_PATH, "/usr/local/bin/node"),
      expected: true,
    },
    {
      content: "fallback-only shim for a different binary",
      script: buildNodeShimScript("/some/other/app"),
      expected: false,
    },
    {
      content: "real-node-preferring shim for a different binary",
      script: buildNodeShimScript("/some/other/app", "/usr/local/bin/node"),
      expected: false,
    },
    { content: "non-shim content", script: "not a shim", expected: false },
    { content: "empty content", script: "", expected: false },
  ])("returns $expected for $content", ({ script, expected }) => {
    expect(isNodeShimScript(script, EXEC_PATH)).toBe(expected);
  });
});
