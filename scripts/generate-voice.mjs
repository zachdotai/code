#!/usr/bin/env node
// Hedgemony voice line generator.
//
// Reads notes/hedgemony/voice-lines.json, calls ElevenLabs for each (unit,
// intent, line, take) tuple in INTENTS_TO_GENERATE, writes wav files into
// apps/code/src/renderer/assets/sounds/voice/. ElevenLabs returns raw PCM;
// we prepend a standard 44-byte WAV header.
//
// Usage:
//   node --env-file=.env scripts/generate-voice.mjs
//
// Re-running is safe: existing files are skipped unless --force is passed.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SCRIPT_PATH = join(REPO_ROOT, "notes/hedgemony/voice-lines.json");
const OUT_DIR = join(
  REPO_ROOT,
  "apps/code/src/renderer/assets/sounds/voice",
);

const TAKES_PER_LINE = 3;
const FORCE = process.argv.includes("--force");

// First pass: only the three highest-value intents. Expand once we've
// auditioned these in context.
const INTENTS_TO_GENERATE = new Set([
  "hoglet:select",
  "hoglet:order_move",
  "hedgehog:goal_complete",
]);

// Best-guess voice IDs from ElevenLabs' default library. Override by setting
// ELEVENLABS_VOICE_<UNIT>=<voice_id> in the environment.
const DEFAULT_VOICES = {
  hoglet: "pFZP5JQG7iQjIQuC4Bku", // Lily — warm British female
  hedgehog: "JBFqnCBsd6RMkjVDRZzb", // George — warm British male
  builder: "onwK4e9ZLuTAKqWW03F9", // Daniel — British, authoritative
  system: "Xb7hH8MSUJpSbSDYk0k2", // Alice — British, neutral
};

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

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let totalChars = 0;

  for (const [unitName, unit] of Object.entries(script.units)) {
    const voiceId =
      process.env[`ELEVENLABS_VOICE_${unitName.toUpperCase()}`] ??
      DEFAULT_VOICES[unitName];
    if (!voiceId) {
      console.warn(`[skip unit] no voice id for "${unitName}"`);
      continue;
    }

    for (const [intent, lines] of Object.entries(unit.lines)) {
      const key = `${unitName}:${intent}`;
      if (!INTENTS_TO_GENERATE.has(key)) continue;

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const text = lines[lineIdx];
        for (let take = 1; take <= TAKES_PER_LINE; take++) {
          const filename = `${unitName}_${intent}_l${String(lineIdx + 1).padStart(2, "0")}_t${take}.wav`;
          const outPath = join(OUT_DIR, filename);
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
            process.stdout.write(`  ✓ ${filename}  "${text}"\n`);
          } catch (error) {
            failed++;
            console.error(`  ✗ ${filename}: ${error.message}`);
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
