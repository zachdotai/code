import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { defineConfig } from "tsup";
// Plain ESM helper, shared with apps/code/vite-main-plugins.mts.
import {
  CLAUDE_CLI_SUPPORT_DIRS,
  CLAUDE_CLI_SUPPORT_FILES,
  claudeBinName,
  claudeExecutableCandidates,
  targetArch,
  targetPlatform,
} from "./build/native-binary.mjs";
import {
  ensureRtkBinary,
  RTK_VERSION,
  rtkReleaseTarget,
} from "./build/rtk-binary.mjs";

function nativeBinarySourcePath(): string | undefined {
  const candidates = claudeExecutableCandidates(
    resolve(import.meta.dirname, "../../node_modules"),
  );
  return candidates.find((p: string) => existsSync(p));
}

function copyClaudeSupportAssets(sourcePath: string, destDir: string): void {
  const sourceDir = dirname(sourcePath);

  for (const file of CLAUDE_CLI_SUPPORT_FILES) {
    const source = resolve(sourceDir, file);
    if (existsSync(source)) {
      copyFileSync(source, resolve(destDir, file));
    }
  }

  for (const dir of CLAUDE_CLI_SUPPORT_DIRS) {
    const source = resolve(sourceDir, dir);
    if (existsSync(source)) {
      cpSync(source, resolve(destDir, dir), { recursive: true });
    }
  }
}

function copyAssets() {
  const distDir = resolve(import.meta.dirname, "dist");
  const templatesDir = resolve(distDir, "templates");
  const claudeCliDir = resolve(distDir, "claude-cli");

  mkdirSync(templatesDir, { recursive: true });
  mkdirSync(claudeCliDir, { recursive: true });

  const srcTemplatesDir = resolve(import.meta.dirname, "src/templates");
  if (existsSync(srcTemplatesDir)) {
    cpSync(srcTemplatesDir, templatesDir, { recursive: true });
  }

  const binName = claudeBinName();
  const nativeBinary = nativeBinarySourcePath();
  if (nativeBinary) {
    const dest = resolve(claudeCliDir, binName);
    copyFileSync(nativeBinary, dest);
    if (targetPlatform() !== "win32") {
      chmodSync(dest, 0o755);
    }
    copyClaudeSupportAssets(nativeBinary, claudeCliDir);
  } else {
    console.warn(
      `[agent/tsup] No Claude executable found for ${targetPlatform()}-${targetArch()}; install @anthropic-ai/claude-agent-sdk optional deps`,
    );
  }

  writeFileSync(
    resolve(claudeCliDir, "package.json"),
    JSON.stringify({ type: "module" }, null, 2),
  );
}

// Vendor the pinned RTK binary into dist/rtk/ so cloud runs and the desktop app
// use one consistent version instead of relying on rtk being on PATH. Downloads
// on first build and caches under node_modules/.cache; best-effort so an
// offline build still succeeds (runtime then falls back to PATH).
async function copyRtkAsset() {
  const rtkDir = resolve(import.meta.dirname, "dist", "rtk");
  try {
    const dest = await ensureRtkBinary(rtkDir);
    if (dest) {
      console.log(
        `[agent/tsup] Bundled rtk ${RTK_VERSION} (${rtkReleaseTarget()})`,
      );
    } else {
      console.warn(
        `[agent/tsup] No rtk release for ${targetPlatform()}-${targetArch()}; skipping bundle (runtime falls back to PATH)`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[agent/tsup] Failed to bundle rtk: ${message}. Cloud runs will fall back to PATH.`,
    );
  }
}

const sharedOptions = {
  sourcemap: true,
  splitting: false,
  outDir: "dist",
  target: "node20",
  noExternal: [
    "@posthog/shared",
    "@posthog/git",
    "@posthog/enricher",
    "fflate",
  ],
  external: [
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
    "@agentclientprotocol/sdk",
    "@anthropic-ai/claude-agent-sdk",
    "dotenv",
    "openai",
    "tar",
    "zod",
  ],
};

export default defineConfig([
  {
    entry: [
      "src/index.ts",
      "src/acp-extensions.ts",
      "src/agent.ts",
      "src/gateway-models.ts",
      "src/handoff-checkpoint.ts",
      "src/posthog-api.ts",
      "src/posthog-products.ts",
      "src/pr-url-detector.ts",
      "src/resume.ts",
      "src/types.ts",
      "src/adapters/claude/questions/utils.ts",
      "src/adapters/claude/permissions/permission-options.ts",
      "src/adapters/claude/tools.ts",
      "src/adapters/claude/conversion/tool-use-to-acp.ts",
      "src/adapters/claude/session/jsonl-hydration.ts",
      "src/adapters/claude/session/models.ts",
      "src/adapters/codex/models.ts",
      "src/adapters/claude/mcp/tool-metadata.ts",
      "src/adapters/codex/structured-output-mcp-server.ts",
      "src/adapters/codex/local-tools-mcp-server.ts",
      "src/adapters/reasoning-effort.ts",
      "src/execution-mode.ts",
      "src/server/schemas.ts",
      "src/server/agent-server.ts",
    ],
    format: ["esm"],
    dts: true,
    clean: false,
    ...sharedOptions,
    onSuccess: async () => {
      copyAssets();
      await copyRtkAsset();
      console.log("Assets copied successfully");

      // Touch a trigger file to signal electron-forge to restart
      // This file is watched by Vite, triggering main process rebuild
      // Skip in Docker/CI environments where the code app doesn't exist
      const triggerFile = resolve(
        import.meta.dirname,
        "../../apps/code/src/main/.agent-trigger",
      );
      const triggerDir = resolve(
        import.meta.dirname,
        "../../apps/code/src/main",
      );
      if (existsSync(triggerDir)) {
        writeFileSync(triggerFile, `${Date.now()}`);
      }
    },
  },
  {
    entry: { "server/bin": "src/server/bin.ts" },
    format: ["cjs"],
    dts: false,
    clean: false,
    ...sharedOptions,
  },
]);
