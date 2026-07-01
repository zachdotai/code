#!/usr/bin/env node

// Download the quantized Whisper model used by offline voice dictation and place
// it in each host's public/whisper/ dir. Kept out of the default install (it's
// ~57 MB) — run it explicitly (`pnpm whisper:model`) or from a release build.
//
// The model is English-only (ggml-base.en); swapping MODEL below to a
// multilingual build also means passing the host language (not "en") in
// useWhisperDictation.

import { createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

const MODEL = {
  file: "ggml-base.en-q5_1.bin",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin",
  // Approximate size (bytes) for a sanity check; a truncated download is the
  // common failure and this catches it without a brittle exact-hash pin.
  minBytes: 50_000_000,
};

const DEST_DIRS = [
  join(REPO_ROOT, "apps", "code", "public", "whisper"),
  join(REPO_ROOT, "apps", "web", "public", "whisper"),
];

const MAX_ATTEMPTS = 4;

async function fileHasEnoughBytes(path) {
  try {
    const info = await stat(path);
    return info.size >= MODEL.minBytes;
  } catch {
    return false;
  }
}

async function downloadTo(path) {
  await mkdir(dirname(path), { recursive: true });
  if (await fileHasEnoughBytes(path)) {
    console.log(`✓ ${path} already present — skipping`);
    return;
  }

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(
        `Downloading ${MODEL.file} → ${path} (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      const response = await fetch(MODEL.url, { redirect: "follow" });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      const tmp = `${path}.partial`;
      await pipeline(Readable.fromWeb(response.body), createWriteStream(tmp));
      if (!(await fileHasEnoughBytes(tmp))) {
        await rm(tmp, { force: true });
        throw new Error(
          "downloaded file is smaller than expected (truncated?)",
        );
      }
      // Atomic-ish swap so a partial download never masquerades as the model.
      await rm(path, { force: true });
      await rename(tmp, path);
      console.log(`✓ ${path}`);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`  attempt ${attempt} failed: ${error.message}`);
      if (attempt < MAX_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw new Error(
    `Failed to download ${MODEL.file} after ${MAX_ATTEMPTS} attempts: ${lastError?.message}`,
  );
}

async function main() {
  // Download once, then copy to the remaining dirs to avoid re-fetching 57 MB.
  const [primary, ...rest] = DEST_DIRS;
  await downloadTo(join(primary, MODEL.file));

  for (const dir of rest) {
    const target = join(dir, MODEL.file);
    if (await fileHasEnoughBytes(target)) {
      console.log(`✓ ${target} already present — skipping`);
      continue;
    }
    await mkdir(dir, { recursive: true });
    await copyFile(join(primary, MODEL.file), target);
    console.log(`✓ ${target} (copied)`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
