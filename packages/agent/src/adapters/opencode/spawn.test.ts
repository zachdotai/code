import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Logger } from "../../utils/logger";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const { spawnOpencodeProcess } = await import("./spawn");

function makeFakeChild() {
  return {
    stdin: { destroy: vi.fn() },
    stdout: { on: vi.fn(), destroy: vi.fn() },
    stderr: { on: vi.fn(), destroy: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    pid: 4321,
  };
}

function setup() {
  const configDir = mkdtempSync(join(tmpdir(), "opencode-spawn-test-"));
  const binaryPath = join(configDir, "opencode-bin");
  writeFileSync(binaryPath, "#!/bin/sh\n");
  return { configDir, binaryPath };
}

describe("spawnOpencodeProcess opencode.json", () => {
  it("registers the gateway as a Chat-Completions provider with an env-injected token", () => {
    spawnMock.mockClear();
    spawnMock.mockReturnValue(makeFakeChild());
    const { configDir, binaryPath } = setup();

    spawnOpencodeProcess({
      logger: new Logger({ debug: false }),
      configDir,
      binaryPath,
      apiBaseUrl: "https://gateway.us.posthog.com/posthog_code/v1",
      apiKey: "phx_secret",
      model: "@cf/zai-org/glm-5.2",
    });

    const config = JSON.parse(
      readFileSync(join(configDir, "opencode.json"), "utf8"),
    );
    expect(config.provider.posthog.npm).toBe("@ai-sdk/openai-compatible");
    expect(config.provider.posthog.options.baseURL).toBe(
      "https://gateway.us.posthog.com/posthog_code/v1",
    );
    expect(config.provider.posthog.options.apiKey).toBe(
      "{env:POSTHOG_GATEWAY_API_KEY}",
    );
    expect(config.provider.posthog.models["@cf/zai-org/glm-5.2"]).toEqual({
      name: "glm-5.2",
    });
    expect(config.model).toBe("posthog/@cf/zai-org/glm-5.2");
    // The real token is never inlined into the config file.
    expect(JSON.stringify(config)).not.toContain("phx_secret");
  });
});

describe("spawnOpencodeProcess env + command", () => {
  it("isolates XDG state under the config dir and injects the token + config path", () => {
    spawnMock.mockClear();
    spawnMock.mockReturnValue(makeFakeChild());
    const { configDir, binaryPath } = setup();

    spawnOpencodeProcess({
      logger: new Logger({ debug: false }),
      configDir,
      binaryPath,
      apiKey: "phx_secret",
    });

    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe(binaryPath);
    expect(args).toEqual(["acp"]);
    const env = options.env;
    expect(env.POSTHOG_GATEWAY_API_KEY).toBe("phx_secret");
    expect(env.OPENCODE_CONFIG).toBe(join(configDir, "opencode.json"));
    expect(env.XDG_DATA_HOME).toBe(join(configDir, "xdg", "data"));
    expect(env.XDG_STATE_HOME).toBe(join(configDir, "xdg", "state"));
    expect(env.XDG_CACHE_HOME).toBe(join(configDir, "xdg", "cache"));
    expect(env.XDG_CONFIG_HOME).toBe(join(configDir, "xdg", "config"));
  });
});

describe("spawnOpencodeProcess binary resolution", () => {
  it("throws a clear error when no binary is available", () => {
    spawnMock.mockClear();
    const { configDir } = setup();
    const prev = process.env.OPENCODE_BIN;
    process.env.OPENCODE_BIN = "";
    try {
      expect(() =>
        spawnOpencodeProcess({
          logger: new Logger({ debug: false }),
          configDir,
        }),
      ).toThrow(/opencode binary/);
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_BIN;
      else process.env.OPENCODE_BIN = prev;
    }
  });
});
