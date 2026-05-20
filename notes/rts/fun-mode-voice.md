# Fun-mode voice packs

> **Status:** Plan of record. Pairs with [voice-generation.md](./voice-generation.md)
> (which covers the baseline "none" voice). This doc extends that pipeline so
> Hedgemony's pirate and lolcat fun modes get their own sound bites in addition
> to the existing text rewrites.

## Context

Fun mode (`useSettingsStore.funMode`: `"none" | "pirate" | "lolcat"`) currently
rewrites visible text via `funSpeak()` and changes the hedgehog's visual
accessories. The audio layer is mode-agnostic — `playVoice("hoglet:select")`
fires the same earnest-British-radio-operator clip regardless of mode, which
breaks the joke. A pirate-mode hoglet should sound like a pirate; a lolcat-mode
hoglet should sound… off, in a way the team will get to decide.

The text rewrites are algorithmic, but the voice clips can't be — TTS reading
"oh hai i can has" literally sounds stilted. We need **hand-written lines per
mode**, voiced by a per-mode voice profile, played through the existing
`voice.ts` engine after a small mode-aware refactor.

This plan covers both `pirate` and `lolcat` and is structured so the system
keeps working if a third mode shows up later — adding a mode is "write lines,
generate clips, drop folder, done."

## Architecture

**Storage** — Subdirectory per mode under `apps/code/src/renderer/assets/sounds/voice/`:

```
voice/
  none/      ← existing 45 WAVs move here
    hoglet_select_l01_t1.wav
    ...
  pirate/
    hoglet_select_l01_t1.wav
    ...
  lolcat/
    hoglet_select_l01_t1.wav
    ...
```

Filenames are identical across modes. Mode is implicit in the directory. The
existing `<unit>_<intent>_l<N>_t<N>.wav` convention is preserved — only the
glob path changes.

**Runtime** — `voice.ts` (registry + playback) becomes mode-aware via a
push-based setter, matching the existing `setVoiceMuted` / `setVoiceVolume`
pattern so call sites stay unchanged:

```ts
// voice.ts
export type VoiceMode = "none" | "pirate" | "lolcat";

const REGISTRY: Record<VoiceMode, Record<VoiceIntent, string[]>> = buildRegistry();
let currentMode: VoiceMode = "none";

export function setVoiceMode(next: VoiceMode): void {
  currentMode = next;
}

export function playVoice(intent: VoiceIntent): void {
  if (muted) return;
  const candidates =
    REGISTRY[currentMode][intent].length > 0
      ? REGISTRY[currentMode][intent]
      : REGISTRY.none[intent]; // fall back if a mode is missing this intent
  // ...existing throttle + pick logic
}
```

`buildRegistry()` runs a single Vite glob over `voice/**/*.wav` and keys
clips by the first path segment (the mode folder).

**Bridge** — `SfxBridge.tsx` already subscribes to `useSfxStore` to push
mute/volume into the engine. Extend it to also subscribe to
`useSettingsStore(s => s.funMode)` and call `setVoiceMode(funMode)` on change.
No new component, no new store.

**Fallback contract** — If a mode has no clips for an intent, fall back to
`none`. This lets us ship modes incrementally (e.g. pirate `hoglet:select`
only) without empty-audio dead spots.

**Throttle state** — Keep the existing `lastPlayedAt` / `lastUrl` maps keyed
by intent only, not by mode. Mode rarely changes mid-session and we don't
want a stale clip to bypass the 600ms throttle just because the user toggled
modes.

## Voice-lines.json extension

Add `lines_pirate` and `lines_lolcat` as siblings of `lines` under each unit.
Indices align with `lines` so a line removed from `none` should be removed from
its fun-mode counterparts (and so generation can pair them by index if we ever
want to).

```jsonc
{
  "units": {
    "hoglet": {
      "voice_hint": "Higher pitch, eager, slightly breathless. ...",
      "voice_hint_pirate": "Same eager hoglet energy, now with a Cornish-pirate lilt. Rolling Rs. Avoid 'arrr' more than once per line.",
      "voice_hint_lolcat": "Stretch vowels, soft sibilants, slightly confused. Like reading a typo out loud. Optional: an actual cat meow on take 3.",
      "lines": {
        "select": ["Hoglet ready.", "Snouts up.", ...]
      },
      "lines_pirate": {
        "select": ["Hoglet at the ready, cap'n.", "Snouts to the wind.", ...]
      },
      "lines_lolcat": {
        "select": ["hoglet redy.", "snoots up.", "i can has order?", ...]
      }
    }
  }
}
```

Writing the actual lines is its own task — see Phase 2.

## Phases

### Phase 1 — Plumbing (no new audio yet)

Goal: ship a mode-aware voice engine that still plays exactly the existing
"none" clips. Safe to land on its own.

1. Create `voice/none/` and move the 45 existing WAVs into it. Update any
   git history concerns (a single `git mv` keeps blame intact).
2. Update `voice.ts`:
   - Change glob to `@renderer/assets/sounds/voice/**/*.wav`.
   - Parse the mode from the first path segment (the folder name).
   - Reshape `REGISTRY` to `Record<VoiceMode, Record<VoiceIntent, string[]>>`.
   - Add `setVoiceMode(mode: VoiceMode)` (default `"none"`).
   - Add the fallback-to-none branch in `playVoice`.
3. Update `SfxBridge.tsx` to subscribe to `funMode` and call `setVoiceMode`.
4. Unit tests in `voice.test.ts` (new file):
   - Registry indexes clips by mode folder.
   - `playVoice` with mode = "pirate" picks pirate clips when present.
   - `playVoice` with mode = "pirate" falls back to "none" when pirate is empty.
   - Mode change doesn't bypass throttle.

**Critical files:**
- `apps/code/src/renderer/features/hedgemony/audio/voice.ts`
- `apps/code/src/renderer/features/hedgemony/audio/SfxBridge.tsx`
- `apps/code/src/renderer/features/hedgemony/audio/voice.test.ts` (new)
- `apps/code/src/renderer/assets/sounds/voice/` (`git mv` to `voice/none/`)

### Phase 2 — Write the lines

Goal: extend `voice-lines.json` with `lines_pirate` and `lines_lolcat` (and
matching `voice_hint_*`) for every intent currently in use:
`hoglet:select`, `hoglet:order_move`, `hedgehog:goal_complete`.

This is a copywriting task, not engineering. Suggested approach:

- **Pirate** — Cornish/RP pirate hybrid. Keep lines under 1.5 seconds. Lean
  on nautical verbs ("bristlin'", "sightin' a PR"). Limit "arrr" to one line
  per intent. Sample: `"Hoglet ready."` → `"Hoglet at the ready, cap'n."`
- **Lolcat** — exaggerated cat-speak read literally. Sample:
  `"Hoglet ready."` → `"hoglet can has order."` The voice direction matters
  more than the words here — the team should commit to one of:
  (a) human voice reading lolcat text deadpan,
  (b) human voice reading lolcat text with cat-affected delivery (yowls, etc.),
  (c) a real cat meow on one of the three takes per line.
  Decide before recording.

**Critical files:**
- `notes/hedgemony/voice-lines.json`

### Phase 3 — Extend the generation script

Goal: update the (still-uncommitted) `scripts/generate-voice.ts` sketched in
[voice-generation.md](./voice-generation.md) so it generates all three modes
in one run.

Key changes:

- Outer loop over `["none", "pirate", "lolcat"]`.
- For each mode, read `lines` (none) or `lines_<mode>` (pirate/lolcat).
- Write to `apps/code/src/renderer/assets/sounds/voice/<mode>/`.
- Voice ID selection extends to a per-(provider, unit, mode) lookup —
  add `voices.elevenlabs.pirate.hoglet`, `voices.elevenlabs.lolcat.hoglet`, etc.
  to `generation_metadata`.

The script stays uncommitted (per `voice-generation.md`'s stance); we generate
locally, commit the resulting WAVs only.

**Critical files:**
- `notes/hedgemony/voice-generation.md` (update the script sketch + add a
  "Fun-mode generation" section pointing here)

### Phase 4 — Placement test (`say` pass)

Goal: generate cheap placeholders for both fun modes and audition them in the
running app before paying for ElevenLabs takes.

- Run `VOICE_PROVIDER=say tsx scripts/generate-voice.ts` (locally, not
  committed). macOS `say` voices: e.g. `-v Daniel` for pirate baseline,
  `-v Karen` or `-v Whisper` for lolcat experiments.
- Toggle through the three fun modes in Settings → General and exercise
  the three current intents (`hoglet:select`, `hoglet:order_move`,
  `hedgehog:goal_complete`).
- Decide which lines survive per mode. Cut anything annoying *before*
  Phase 5.

This phase produces no committed files — it informs Phase 2 (lines) and
Phase 5 (voice cast).

### Phase 5 — Generate finals + commit

Goal: ship the real clips.

- Pick the voice cast per mode (ElevenLabs IDs go in `generation_metadata`).
- Run `VOICE_PROVIDER=elevenlabs tsx scripts/generate-voice.ts`.
- Audition 3 takes per line, hand-pick one, delete the rest.
- Commit picks to `voice/pirate/` and `voice/lolcat/`.
- Asset budget: ~30 lines × 2 modes × 1 take ≈ 60 clips ≈ ~1.8MB. Fine to
  commit; revisit CDN only if `voice/none/` + `pirate/` + `lolcat/` together
  cross ~10MB.

### Phase 6 — Verification

End-to-end test plan, run by whoever lands Phase 5:

1. `pnpm dev` and open the hedgemony map.
2. Settings → General → Fun mode = "Pirate". Click a hoglet — pirate
   "select" plays. Order a move — pirate "order_move" plays. Complete a
   goal — pirate "goal_complete" plays.
3. Switch to "Lolcat". Repeat. Confirm distinct voice profile.
4. Switch to "None". Confirm baseline voice returns.
5. Mute via the audio control — no voice plays in any mode.
6. With a fun mode active but its clip set deliberately incomplete (e.g.
   delete one pirate WAV in dev), confirm the fallback to `none` happens
   silently and is logged.
7. `pnpm --filter code test voice.test.ts` passes.

## Open decisions for the team

These should be settled in PR review or in a quick sync — not assumed:

1. **Lolcat voice direction** — deadpan, affected, or real cat? Affects
   recording cost and casting. Recommend committing to one before Phase 5.
2. **Voice cast reuse** — is the pirate hoglet the same actor as the
   baseline hoglet doing a pirate accent, or a different ElevenLabs voice?
   One actor = consistent character archetype; different actor = stronger
   joke. Recommend "same actor, different accent" for hoglet/hedgehog so
   the operator hears the same creature having a costume change, not
   different creatures.
3. **System / builder intents** — `voice-lines.json` has lines for
   `builder`, `system`, and other hedgehog/hoglet intents that aren't
   wired up at runtime yet (only 3 of the ~15 intents are). Do we
   generate fun-mode versions for all of them now, or only the 3 that
   actually play? Recommend: only the 3 in use. Adding clips for unused
   intents bloats the bundle and we'll have to re-record if we change
   intent names later.
4. **Throttle across mode changes** — currently the throttle is per-intent
   and survives a mode switch. If we want a mode toggle to immediately
   trigger a "demo" line ("Ahoy!"), that's a small extension. Out of
   scope for v1.

## Critical files (consolidated)

- `apps/code/src/renderer/features/hedgemony/audio/voice.ts` — mode-aware
  registry + `setVoiceMode`.
- `apps/code/src/renderer/features/hedgemony/audio/SfxBridge.tsx` — subscribe
  to `useSettingsStore(s => s.funMode)` and push to `setVoiceMode`.
- `apps/code/src/renderer/features/hedgemony/audio/voice.test.ts` — new
  unit tests for the mode-aware registry + fallback.
- `apps/code/src/renderer/assets/sounds/voice/none/` — existing WAVs (moved).
- `apps/code/src/renderer/assets/sounds/voice/pirate/` — new clips.
- `apps/code/src/renderer/assets/sounds/voice/lolcat/` — new clips.
- `notes/hedgemony/voice-lines.json` — `lines_pirate`, `lines_lolcat`,
  `voice_hint_*`, per-mode voice IDs in `generation_metadata`.
- `notes/hedgemony/voice-generation.md` — update the generation-script
  sketch to loop over modes.

## Reused existing code

- `playVoice` / `setVoiceMuted` / `setVoiceVolume` push pattern in
  `voice.ts:29-35` — `setVoiceMode` matches this shape exactly.
- `SfxBridge` subscription pattern in `SfxBridge.tsx` — already wires
  store → engine for mute/volume; extend the same component.
- `FunMode` type from
  `apps/code/src/renderer/features/settings/stores/settingsStore.ts` —
  reuse as `VoiceMode`; if they ever diverge we can split, but they
  shouldn't.
- Existing batch generation script sketch in
  `notes/hedgemony/voice-generation.md` — extend in place.
