import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { ProcessSpawnedCallback } from "../../types";
import { Logger } from "../../utils/logger";

/**
 * Env var the generated opencode.json references via `{env:...}` so the gateway
 * token is never written to disk in the config file.
 */
const GATEWAY_TOKEN_ENV = "POSTHOG_GATEWAY_API_KEY";

/** opencode provider key under which the gateway is registered in opencode.json. */
const PROVIDER_KEY = "posthog";

export interface OpencodeProcessOptions {
  cwd?: string;
  /** Gateway base URL ending in `/v1` (the OpenAI-compatible Chat Completions surface). */
  apiBaseUrl?: string;
  apiKey?: string;
  /** Bare gateway model id, e.g. "@cf/zai-org/glm-5.2". */
  model?: string;
  /**
   * Run-private directory that holds the generated opencode.json and all of
   * opencode's XDG state (db, cache, sessions). Isolating it keeps the spike/
   * adapter from touching the user's global ~/.local/share/opencode db — sharing
   * it triggers schema-mismatch crashes and risks corrupting real sessions.
   */
  configDir?: string;
  /** Appended to opencode's instructions (parity with codex `developerInstructions`). */
  developerInstructions?: string;
  /**
   * Path to the native `opencode-<platform>-<arch>/bin/opencode` binary. The
   * `opencode-ai` npm launcher mangles ACP-over-stdio when spawned as a
   * subprocess, so the native binary must be invoked directly (no npx fallback).
   */
  binaryPath?: string;
  logger?: Logger;
  processCallbacks?: ProcessSpawnedCallback;
  /** Extra writable roots (parity with codex; opencode reads them from config). */
  additionalDirectories?: string[];
}

export interface OpencodeProcess {
  process: ChildProcess;
  stdin: Writable;
  stdout: Readable;
  kill: () => void;
}

/**
 * Build the opencode.json that registers the PostHog gateway as a custom
 * `@ai-sdk/openai-compatible` provider (Chat Completions wire format — GLM's
 * native surface) and pins the default model. The token is injected via
 * `{env:...}` rather than inlined.
 */
function buildOpencodeConfig(
  options: OpencodeProcessOptions,
): Record<string, unknown> {
  const model = options.model;
  const models: Record<string, unknown> = {};
  if (model) {
    models[model] = { name: model.split("/").pop() ?? model };
  }

  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      [PROVIDER_KEY]: {
        npm: "@ai-sdk/openai-compatible",
        name: "PostHog Gateway",
        options: {
          baseURL: options.apiBaseUrl,
          apiKey: `{env:${GATEWAY_TOKEN_ENV}}`,
        },
        models,
      },
    },
  };

  if (model) {
    config.model = `${PROVIDER_KEY}/${model}`;
  }
  if (options.developerInstructions) {
    config.instructions = [options.developerInstructions];
  }

  return config;
}

function resolveConfigDir(options: OpencodeProcessOptions): string {
  const dir = options.configDir;
  if (!dir) {
    throw new Error(
      "opencode requires a run-private configDir to hold opencode.json and isolated XDG state",
    );
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

function findOpencodeBinary(options: OpencodeProcessOptions): string {
  const bin = options.binaryPath ?? process.env.OPENCODE_BIN;
  if (bin && existsSync(bin)) {
    return bin;
  }
  if (bin) {
    throw new Error(
      `opencode binary not found at ${bin}. Run "node apps/code/scripts/download-binaries.mjs" to download it.`,
    );
  }
  throw new Error(
    "opencode binary path not provided. Set OpencodeProcessOptions.binaryPath or the OPENCODE_BIN env var — the npx `opencode-ai` launcher does not work for ACP over stdio.",
  );
}

export function spawnOpencodeProcess(
  options: OpencodeProcessOptions,
): OpencodeProcess {
  const logger =
    options.logger ?? new Logger({ debug: true, prefix: "[OpencodeSpawn]" });

  const configDir = resolveConfigDir(options);
  const configPath = join(configDir, "opencode.json");
  writeFileSync(
    configPath,
    JSON.stringify(buildOpencodeConfig(options), null, 2),
  );

  const command = findOpencodeBinary(options);

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;

  if (options.apiKey) {
    env[GATEWAY_TOKEN_ENV] = options.apiKey;
  }

  // Point opencode at our generated config and isolate ALL of its state into the
  // run-private dir so it never reads/writes the user's global opencode db.
  env.OPENCODE_CONFIG = configPath;
  env.XDG_DATA_HOME = join(configDir, "xdg", "data");
  env.XDG_STATE_HOME = join(configDir, "xdg", "state");
  env.XDG_CACHE_HOME = join(configDir, "xdg", "cache");
  env.XDG_CONFIG_HOME = join(configDir, "xdg", "config");

  if (options.binaryPath && existsSync(options.binaryPath)) {
    const binDir = dirname(options.binaryPath);
    env.PATH = `${binDir}${delimiter}${env.PATH ?? ""}`;
  }

  const args = ["acp"];

  logger.info("Spawning opencode acp process", {
    command,
    cwd: options.cwd,
    configDir,
    hasApiBaseUrl: !!options.apiBaseUrl,
    hasApiKey: !!options.apiKey,
    model: options.model,
  });

  const child = spawn(command, args, {
    cwd: options.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  child.stderr?.on("data", (data: Buffer) => {
    logger.warn("opencode stderr:", data.toString());
  });

  child.on("error", (err) => {
    logger.error("opencode process error:", err);
  });

  child.on("exit", (code, signal) => {
    logger.info("opencode process exited", { code, signal });
    if (child.pid && options.processCallbacks?.onProcessExited) {
      options.processCallbacks.onProcessExited(child.pid);
    }
  });

  if (!child.stdin || !child.stdout) {
    throw new Error("Failed to get stdio streams from opencode process");
  }

  if (child.pid && options.processCallbacks?.onProcessSpawned) {
    options.processCallbacks.onProcessSpawned({ pid: child.pid, command });
  }

  return {
    process: child,
    stdin: child.stdin,
    stdout: child.stdout,
    kill: () => {
      logger.info("Killing opencode process", { pid: child.pid });
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.kill("SIGTERM");
    },
  };
}
