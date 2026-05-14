#!/usr/bin/env node
// Hedgemony voice line generator.
//
// Reads notes/hedgemony/voice-lines.json, calls ElevenLabs for every
// (unit, intent, line, take) tuple in BOTH male and female voices, writes
// wav files into apps/code/src/renderer/assets/sounds/voice/<gender>/.
// ElevenLabs returns raw PCM; we prepend a standard 44-byte WAV header.
//
// Voice IDs come from voice-lines.json's generation_metadata.voices.elevenlabs.
// Only the API key lives in .env.
//
// Usage:
//   node --env-file=.env scripts/generate-voice.mjs
//   node --env-file=.env scripts/generate-voice.mjs --force         # overwrite existing
//   node --env-file=.env scripts/generate-voice.mjs --gender=male   # one gender only
//
// Re-running is safe: existing files are skipped unless --force is passed.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SCRIPT_PATH = join(REPO_ROOT, "notes/hedgemony/voice-lines.json");
const OUT_DIR = join(REPO_ROOT, "apps/code/src/renderer/assets/sounds/voice");

const FORCE = process.argv.includes("--force");
const GENDER_FILTER = (() => {
  const arg = process.argv.find((a) => a.startsWith("--gender="));
  return arg ? arg.split("=")[1] : null;
})();

const VOICE_SETTINGS = {
  stability: 0.4, // lower = more emotional variation; suits "slightly anxious"
  similarity_boost: 0.75,
  style: 0.3,
  use_speaker_boost: true,
};

const MODEL_ID = "eleven_multilingual_v2";
const SAMPLE_RATE = 22050;
const OUTPUT_FORMAT = `pcm_${SAMPLE_RATE}`;

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

  const voicesByGender = script.generation_metadata?.voices?.elevenlabs ?? {};
  const genders = Object.entries(voicesByGender)
    .filter(([key]) => key !== "$comment")
    .filter(([gender]) => !GENDER_FILTER || gender === GENDER_FILTER);
  if (genders.length === 0) {
    console.error("No usable voice IDs in voice-lines.json generation_metadata.voices.elevenlabs");
    process.exit(1);
  }

  const takesPerLine = script.generation_metadata?.takes_per_line ?? 3;

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let totalChars = 0;

  // System lives at the top level of voice-lines.json; treat it like any other
  // unit for generation purposes.
  const allUnits = { ...script.units };
  if (script.system?.lines) allUnits.system = { lines: script.system.lines };

  for (const [gender, voiceId] of genders) {
    const genderDir = join(OUT_DIR, gender);
    if (!existsSync(genderDir)) mkdirSync(genderDir, { recursive: true });
    console.log(`\n— ${gender} (${voiceId}) —`);

    for (const [unitName, unit] of Object.entries(allUnits)) {
      for (const [intent, lines] of Object.entries(unit.lines)) {
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const text = lines[lineIdx];
          for (let take = 1; take <= takesPerLine; take++) {
            const filename = `${unitName}_${intent}_l${String(lineIdx + 1).padStart(2, "0")}_t${take}.wav`;
            const outPath = join(genderDir, filename);
            if (existsSync(outPath) && !FORCE) {
              skipped++;
              continue;
            }
            try {
              const pcm = await tts(apiKey, voiceId, text);
              const wav = pcmToWav(pcm, SAMPLE_RATE);
              writeFileSync(outPath, wav);
              totalChars += text.length;
              generated++;
              process.stdout.write(`  ✓ ${gender}/${filename}  "${text}"\n`);
            } catch (error) {
              failed++;
              console.error(`  ✗ ${gender}/${filename}: ${error.message}`);
            }
          }
        }
      }
    }
  }

  console.log("");
  console.log(`Generated: ${generated}`);
  console.log(`Skipped (already exist): ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Characters billed: ${totalChars}`);
  console.log(`Output: ${OUT_DIR}`);
}

async function tts(apiKey, voiceId, text) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/wav",
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

// Wraps mono 16-bit signed little-endian PCM in a standard WAV header.
// ElevenLabs returns raw PCM at the requested sample rate when output_format
// is `pcm_*`; we add the 44-byte RIFF/WAVE header so the file is a valid .wav.
function pcmToWav(pcm, sampleRate) {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
