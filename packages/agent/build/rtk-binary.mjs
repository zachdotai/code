import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
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

// SHA-256 of each release archive (from the release's checksums.txt), pinned
// alongside RTK_VERSION so a swapped release asset or a corrupt/truncated
// download fails the build instead of being cached and bundled. Update both
// RTK_VERSION and these hashes together when bumping rtk.
const RTK_SHA256 = {
  "aarch64-apple-darwin":
    "8a17e49acbd378997eb21d0eb6f7f861111f35b4fc9b1c74edf4c7448e576c65",
  "aarch64-unknown-linux-gnu":
    "5519f7ca12e5c143a609f0d28a0a77b97413a8dce31c2681f1a41c24519a8731",
  "x86_64-apple-darwin":
    "a85f60e2637811be68366208b8d8b9c5ba1b748cb5df4477ab20cd73d3c5d9f8",
  "x86_64-pc-windows-msvc":
    "7c5e4a2ef816a4d4ed947ddd74ca3df851fc39ea87d49a3ca2bf3abc515a016b",
  "x86_64-unknown-linux-musl":
    "ff8a1e7766496e175291a85aeca1dc97c9ff6df33e51e5893d1fbc78fea2a609",
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

async function verifyChecksum(archivePath, target) {
  const expected = RTK_SHA256[target];
  if (!expected) {
    throw new Error(`No pinned checksum for rtk target ${target}`);
  }
  const hash = createHash("sha256");
  await pipeline(createReadStream(archivePath), hash);
  const actual = hash.digest("hex");
  if (actual !== expected) {
    throw new Error(
      `rtk checksum mismatch for ${target}: expected ${expected}, got ${actual}`,
    );
  }
}

// Both archive layouts are expected to place the binary at the archive root
// (verified for rtk 0.43.0): the tar path relies on that so `extract` drops
// `rtk` directly into destDir, and the zip path looks it up by the bare name
// first. If a future rtk release nests the binary under a directory, the tar
// path extracts nothing useful and the caller's post-extraction existence
// check fails loudly — the zip path additionally tries the `rtk-<target>/`
// prefix as a fallback.
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
    // Download, verify, and extract inside a per-process temp dir so a killed
    // build cannot leave a partial or unverified artifact that a later (or
    // concurrent) build reuses; only the final rename publishes into cacheDir.
    // Use dirname(cacheDir) so the temp dir and cacheDir are on the same
    // filesystem: rename(2) fails with EXDEV across filesystems (e.g. tmpfs /tmp
    // vs overlay node_modules/.cache in Docker / CI containers).
    const tmpDir = mkdtempSync(join(dirname(cacheDir), ".tmp-"));
    try {
      const archivePath = join(
        tmpDir,
        target.includes("windows") ? "rtk.zip" : "rtk.tar.gz",
      );
      await downloadFile(url, archivePath);
      await verifyChecksum(archivePath, target);
      await extractArchive(archivePath, tmpDir, target);
      const extractedBinary = join(tmpDir, binName);
      if (!existsSync(extractedBinary)) {
        throw new Error(
          `rtk binary missing after extraction: ${extractedBinary} — the release archive layout for ${target} may have changed`,
        );
      }
      try {
        renameSync(extractedBinary, cachedBinary);
      } catch (renameError) {
        // Two concurrent cold-cache builds can race to the same destination.
        // On Windows renameSync throws when the destination already exists;
        // if the winner already wrote the file, the loser can proceed safely.
        if (!existsSync(cachedBinary)) throw renameError;
      }
    } finally {
      rmSync(tmpDir, { force: true, recursive: true });
    }
  }

  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, binName);
  copyFileSync(cachedBinary, dest);
  if (targetPlatform() !== "win32") chmodSync(dest, 0o755);
  return dest;
}
