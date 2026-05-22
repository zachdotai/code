#!/usr/bin/env node
// Hedgemony voice line generator.
//
// Reads notes/rts/voice-lines.json, calls ElevenLabs for every
// (mode, gender, unit, intent, line, take) tuple, writes mp3 files into
// apps/code/src/renderer/assets/sounds/voice/<mode>/<gender>/.
// Output is mp3_22050_32 (32 kbps mono mp3 at 22 kHz) — small + ready to ship.
//
// Voice IDs come from voice-lines.json's generation_metadata.voices.elevenlabs
// keyed by mode → gender. Only the API key lives in .env.
//
// Usage:
//   node --env-file=.env scripts/generate-voice.mjs
//   node --env-file=.env scripts/generate-voice.mjs --force            # overwrite existing
//   node --env-file=.env scripts/generate-voice.mjs --mode=pirate      # one mode only
//   node --env-file=.env scripts/generate-voice.mjs --gender=male      # one gender only
//
// Re-running is safe: existing files are skipped unless --force is passed.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SCRIPT_PATH = join(REPO_ROOT, "notes/rts/voice-lines.json");
const OUT_DIR = join(REPO_ROOT, "apps/code/src/renderer/assets/sounds/voice");

const FORCE = process.argv.includes("--force");
const argValue = (flag) => {
  const arg = process.argv.find((a) => a.startsWith(`${flag}=`));
  return arg ? arg.split("=")[1] : null;
};
const MODE_FILTER = argValue("--mode");
const GENDER_FILTER = argValue("--gender");

const VOICE_SETTINGS = {
  stability: 0.4, // lower = more emotional variation; suits "slightly anxious"
  similarity_boost: 0.75,
  style: 0.3,
  use_speaker_boost: true,
};

const MODEL_ID = "eleven_multilingual_v2";
const OUTPUT_FORMAT = "mp3_22050_32";

// Maps fun mode → the key under each unit holding that mode's lines.
const LINES_KEY = {
  none: "lines",
  pirate: "lines_pirate",
  lolcat: "lines_lolcat",
};

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error(
      "Missing ELEVENLABS_API_KEY. Run with: node --env-file=.env scripts/generate-voice.mjs",
    );
    process.exit(1);
  }

  const script = JSON.parse(
    await import("node:fs/promises").then((fs) =>
      fs.readFile(SCRIPT_PATH, "utf8"),
    ),
  );

  const voicesByMode = script.generation_metadata?.voices?.elevenlabs ?? {};
  const modes = Object.entries(voicesByMode)
    .filter(([key]) => key !== "$comment")
    .filter(([mode]) => !MODE_FILTER || mode === MODE_FILTER);
  if (modes.length === 0) {
    console.error(
      "No usable voice IDs in voice-lines.json generation_metadata.voices.elevenlabs",
    );
    process.exit(1);
  }

  const takesPerLine = script.generation_metadata?.takes_per_line ?? 3;

  // System lives at the top level of voice-lines.json; treat it like any other
  // unit for generation purposes.
  const allUnits = { ...script.units };
  if (script.system) allUnits.system = script.system;

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let totalChars = 0;

  for (const [mode, voicesByGender] of modes) {
    const linesKey = LINES_KEY[mode];
    if (!linesKey) {
      console.warn(`[skip mode] no LINES_KEY mapping for "${mode}"`);
      continue;
    }
    const genders = Object.entries(voicesByGender ?? {}).filter(
      ([gender]) => !GENDER_FILTER || gender === GENDER_FILTER,
    );

    for (const [gender, voiceId] of genders) {
      const outSubdir = join(OUT_DIR, mode, gender);
      if (!existsSync(outSubdir)) mkdirSync(outSubdir, { recursive: true });
      console.log(`\n— ${mode}/${gender} (${voiceId}) —`);

      for (const [unitName, unit] of Object.entries(allUnits)) {
        const lineSet = unit[linesKey];
        if (!lineSet) continue;
        for (const [intent, lines] of Object.entries(lineSet)) {
          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const text = lines[lineIdx];
            for (let take = 1; take <= takesPerLine; take++) {
              const filename = `${unitName}_${intent}_l${String(lineIdx + 1).padStart(2, "0")}_t${take}.mp3`;
              const outPath = join(outSubdir, filename);
              if (existsSync(outPath) && !FORCE) {
                skipped++;
                continue;
              }
              try {
                const mp3 = await tts(apiKey, voiceId, text);
                writeFileSync(outPath, mp3);
                totalChars += text.length;
                generated++;
                process.stdout.write(
                  `  ✓ ${mode}/${gender}/${filename}  "${text}"\n`,
                );
              } catch (error) {
                failed++;
                console.error(
                  `  ✗ ${mode}/${gender}/${filename}: ${error.message}`,
                );
              }
            }
          }
        }
      }
    }
  }

  writeManifest();

  console.log("");
  console.log(`Generated: ${generated}`);
  console.log(`Skipped (already exist): ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Characters billed: ${totalChars}`);
  console.log(`Output: ${OUT_DIR}`);
}

// Walk OUT_DIR and write a manifest listing every <mode>/<gender>/<filename>.mp3
// so the renderer can build a CDN URL for each clip without bundling.
function writeManifest() {
  const entries = [];
  for (const mode of readdirSync(OUT_DIR)) {
    const modePath = join(OUT_DIR, mode);
    if (!statSync(modePath).isDirectory()) continue;
    for (const gender of readdirSync(modePath)) {
      const genderPath = join(modePath, gender);
      if (!statSync(genderPath).isDirectory()) continue;
      for (const filename of readdirSync(genderPath)) {
        if (filename.endsWith(".mp3"))
          entries.push(`${mode}/${gender}/${filename}`);
      }
    }
  }
  entries.sort();
  const manifestPath = join(
    REPO_ROOT,
    "apps/code/src/renderer/features/rts/audio/voice-manifest.json",
  );
  writeFileSync(manifestPath, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`Manifest: ${manifestPath} (${entries.length} entries)`);
}

async function tts(apiKey, voiceId, text) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: VOICE_SETTINGS,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
