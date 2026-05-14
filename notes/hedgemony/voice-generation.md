# Voice generation plan

> **Status:** Exploratory. `spec.md` lists voice lines as v1-out-of-scope; treat
> this as a v2 prep doc and/or feature-flagged experiment unless that decision
> is reversed.

## Goal

Generate the static voice clips referenced by `voice-lines.json` once, ship
them as renderer assets (`.ogg`), and play them through the same SFX engine
(or a parallel `voice.ts` module) on the appropriate events.

The runtime app does **not** call any TTS API. All generation is offline,
human-curated, and committed (or hosted on a CDN if size becomes a problem).

## Tool comparison

| Tool                | Voice quality            | Cost shape                | Why pick it                                                         | Why skip                              |
| ------------------- | ------------------------ | ------------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| **ElevenLabs**      | Best in class for character voice acting | $5–22/mo (10k–500k chars/mo) | Distinct character voices; emotion control; closest to Blizzard-VA vibe | Subscription; ToS on commercial use   |
| **OpenAI TTS** (`tts-1-hd`) | Very good, neutral       | $30 / 1M chars            | Pay-as-you-go; no subscription; programmatically simple             | Voices are personable but not "characters" |
| **Suno / Udio**     | Aimed at music, not VO   | Subscription              | Not the right tool                                                  | —                                     |
| **Cartesia / PlayHT** | Very good, fast inference | Subscription / pay-as-you-go | Lowest latency if we ever go realtime                               | Overkill for offline batch            |
| **macOS `say`**     | Decent, free, local      | $0                        | Zero-friction first pass to confirm the *placement* feels right before paying | Robotic; ships fine for internal demo only |

**Recommendation:** Two-pass workflow.

1. **Pass 1 — placement test, free.** Use `say` (macOS) to generate placeholder
   takes for every line. Wire them in, play with timing/density, decide what
   actually fires often vs. rarely. Kill the lines that turn out to be annoying
   *before* paying for real voices.
2. **Pass 2 — final, ElevenLabs.** Pay for one month, generate 3 takes per
   surviving line, hand-pick the best take per line, commit the picks.
   Cancel the subscription. Total chars in this script: ~500, well under the
   smallest plan.

## Batch generation script (sketch — not committed yet)

Drop this in `scripts/generate-voice.ts` once you're ready. It reads
`voice-lines.json`, calls the chosen provider, and writes named `.ogg` files
into `apps/code/src/renderer/assets/sounds/voice/`.

```typescript
// scripts/generate-voice.ts (sketch)
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import voiceLines from "../notes/hedgemony/voice-lines.json";

const OUT_DIR = "apps/code/src/renderer/assets/sounds/voice";
const PROVIDER = process.env.VOICE_PROVIDER ?? "openai"; // "openai" | "elevenlabs" | "say"
const TAKES = voiceLines.generation_metadata.takes_per_line;

async function generate(text: string, voiceId: string, outPath: string) {
  if (PROVIDER === "openai") {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1-hd",
        voice: voiceId,
        input: text,
        response_format: "opus", // close to ogg; transcode if needed
      }),
    });
    await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
  } else if (PROVIDER === "elevenlabs") {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );
    await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
  } else if (PROVIDER === "say") {
    // macOS only — fallback for free placement-test pass
    const { execSync } = await import("node:child_process");
    const aiff = outPath.replace(/\.[^.]+$/, ".aiff");
    execSync(`say -v Daniel "${text.replace(/"/g, '\\"')}" -o ${aiff}`);
    execSync(`afconvert ${aiff} ${outPath} -d 0 -f caff`);
    execSync(`rm ${aiff}`);
  }
}

for (const [unitName, unit] of Object.entries(voiceLines.units)) {
  const voiceId =
    voiceLines.generation_metadata.voices[PROVIDER]?.[unitName] ?? "alloy";
  for (const [intent, lines] of Object.entries(unit.lines)) {
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      for (let take = 1; take <= TAKES; take++) {
        const filename = `${unitName}_${intent}_l${lineIdx + 1}_t${take}.ogg`;
        await generate(lines[lineIdx], voiceId, join(OUT_DIR, filename));
        console.log(filename);
      }
    }
  }
}
```

Run with:

```bash
# Free placement-test pass
VOICE_PROVIDER=say tsx scripts/generate-voice.ts

# Real generation pass
OPENAI_API_KEY=... VOICE_PROVIDER=openai tsx scripts/generate-voice.ts
ELEVENLABS_API_KEY=... VOICE_PROVIDER=elevenlabs tsx scripts/generate-voice.ts
```

Then audition every clip, pick one take per line, delete the others.

## Runtime playback

Mirror the `sfx.ts` pattern but for samples:

- `voice.ts`: module-singleton with a registry mapping `(unit, intent) → asset URLs[]`,
  `playVoice(unit, intent)` picks a random non-repeated take and plays it via a
  pooled `<audio>` element through a `GainNode` if we want to share the master
  volume.
- `voiceStore.ts`: separate mute/volume from sfx. Voice is *much* more annoying
  when overdone — default volume lower, default chattiness setting (e.g.
  "Sparse / Normal / Verbose") that probabilistically suppresses non-essential
  intents like `select` or `complete` (Warcraft 3's "click me 5 times" is
  cute in 2003, terrible in a productivity tool).
- Throttle: never play two voice lines within ~600ms of each other; never
  repeat the same line index twice in a row.
- Respect a global "mission critical only" mode that limits voice to
  `goal_complete`, `intervention_request`, and `blocked`.

## Open decisions before generation

1. **Are we doing voice in v1 at all?** Spec currently says no — confirm before
   paying.
2. **One actor across all units, or distinct?** One actor (with pitch shift) is
   cheaper and avoids the "every NPC sounds different" Bethesda effect.
3. **British or American?** Hedgehog is a UK-coded creature; recommend British.
4. **License terms.** ElevenLabs and OpenAI TTS both currently allow commercial
   use of generated audio under their standard plans — re-check ToS at the
   moment of generation since this changes.
5. **Asset budget.** ~30 lines × 3 takes × ~30KB/clip ≈ 2.7MB before pruning.
   Fine to commit; could move to CDN later.
