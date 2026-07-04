import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { extract } from "tar";
import { targetArch, targetPlatform } from "./native-binary.mjs";

/**
 * Shared build-time helper for vendoring the RTK binary
 * (https://github.com/rtk-ai/rtk) into the agent package's `dist/rtk/`.
 *
 * RTK compresses the output of common dev commands before it reaches the model
 * (see `src/adapters/claude/session/rtk.ts`). We pin a single version here so
 * every host — desktop and cloud runs — uses the same RTK, rather than
 * depending on whatever happens to be on the machine's PATH.
 *
 * There is no npm package for RTK, so we download the pinned release from
 * GitHub at build time and cache it under `node_modules/.cache`. Bundling is
 * best-effort: if the download fails (e.g. offline build) the caller warns and
 * continues, and the runtime resolver falls back to PATH.
 */

export const RTK_VERSION = "0.43.0";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Rust target triples for the RTK GitHub release assets. Linux x64 ships musl
// (static, portable); linux arm64 ships gnu — RTK publishes no arm64 musl or
// Windows arm64 asset, so those combinations resolve to undefined and skip.
const RTK_TARGETS = {
  darwin: { arm64: "aarch64-apple-darwin", x64: "x86_64-apple-darwin" },
  linux: {
    arm64: "aarch64-unknown-linux-gnu",
    x64: "x86_64-unknown-linux-musl",
  },
  win32: { x64: "x86_64-pc-windows-msvc" },
};

export function rtkBinName(platform = targetPlatform()) {
  return platform === "win32" ? "rtk.exe" : "rtk";
}

export function rtkReleaseTarget(
  platform = targetPlatform(),
  arch = targetArch(),
) {
  return RTK_TARGETS[platform]?.[arch];
}

function rtkAssetUrl(target) {
  const ext = target.includes("windows") ? "zip" : "tar.gz";
  return `https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/rtk-${target}.${ext}`;
}

const MAX_DOWNLOAD_ATTEMPTS = 5;
const RETRIABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

class NonRetriableError extends Error {}

function backoffDelayMs(attempt) {
  // Deterministic backoff — build scripts avoid Math.random for reproducibility.
  return Math.min(1000 * 2 ** (attempt - 1), 15000);
}

async function downloadFile(url, destPath) {
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${response.statusText}`;
        if (RETRIABLE_HTTP_STATUSES.has(response.status))
          throw new Error(message);
        throw new NonRetriableError(message);
      }
      await pipeline(response.body, createWriteStream(destPath));
      return;
    } catch (error) {
      if (
        error instanceof NonRetriableError ||
        attempt === MAX_DOWNLOAD_ATTEMPTS
      ) {
        throw error;
      }
      await sleep(backoffDelayMs(attempt));
    }
  }
}

async function extractArchive(archivePath, destDir, target) {
  if (target.includes("windows")) {
    const entries = unzipSync(readFileSync(archivePath));
    const bin = rtkBinName("win32");
    const data = entries[bin] ?? entries[`rtk-${target}/${bin}`];
    if (!data) throw new Error(`rtk binary not found in ${archivePath}`);
    writeFileSync(join(destDir, bin), data);
  } else {
    await extract({ file: archivePath, cwd: destDir });
  }
}

/**
 * Downloads and caches the pinned RTK binary for the build target, then copies
 * it into `destDir`. Returns the path to the bundled binary, or null when RTK
 * publishes no asset for the current platform/arch. Throws on download failure.
 */
export async function ensureRtkBinary(destDir) {
  const target = rtkReleaseTarget();
  if (!target) return null;

  const binName = rtkBinName();
  const cacheDir = resolve(
    __dirname,
    "../../../node_modules/.cache/posthog-rtk",
    RTK_VERSION,
    target,
  );
  const cachedBinary = join(cacheDir, binName);

  if (!existsSync(cachedBinary)) {
    mkdirSync(cacheDir, { recursive: true });
    const url = rtkAssetUrl(target);
    const archivePath = join(
      cacheDir,
      url.endsWith(".zip") ? "rtk.zip" : "rtk.tar.gz",
    );
    await downloadFile(url, archivePath);
    await extractArchive(archivePath, cacheDir, target);
    rmSync(archivePath, { force: true });
    if (!existsSync(cachedBinary)) {
      throw new Error(`rtk binary missing after extraction: ${cachedBinary}`);
    }
  }

  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, binName);
  copyFileSync(cachedBinary, dest);
  if (targetPlatform() !== "win32") chmodSync(dest, 0o755);
  return dest;
}
