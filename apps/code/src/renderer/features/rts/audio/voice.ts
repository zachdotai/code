import type { FunMode } from "@features/settings/stores/settingsStore";
import type { HogletGender } from "@main/services/rts/hoglet-names";
import { logger } from "@utils/logger";
import voiceManifest from "./voice-manifest.json";

const log = logger.scope("hedgemony-voice");

export type VoiceIntent =
  | "builder:build_mode"
  | "builder:place_nest"
  | "builder:select"
  | "hedgehog:goal_complete"
  | "hedgehog:intervention_request"
  | "hedgehog:nest_established"
  | "hedgehog:select"
  | "hoglet:blocked"
  | "hoglet:complete"
  | "hoglet:order_move"
  | "hoglet:order_work"
  | "hoglet:select"
  | "system:error"
  | "system:signal_arrived";

export type VoiceMode = FunMode;

const VOICE_BASE_URL =
  import.meta.env.VITE_CODE_RTS_VOICE_BASE_URL ??
  "https://posthog.com/code-rts/voice";

const voiceFiles: Record<string, string> = Object.fromEntries(
  (voiceManifest as string[]).map((entry) => [
    entry,
    `${VOICE_BASE_URL}/${entry}`,
  ]),
);

const ALL_INTENTS: VoiceIntent[] = [
  "builder:build_mode",
  "builder:place_nest",
  "builder:select",
  "hedgehog:goal_complete",
  "hedgehog:intervention_request",
  "hedgehog:nest_established",
  "hedgehog:select",
  "hoglet:blocked",
  "hoglet:complete",
  "hoglet:order_move",
  "hoglet:order_work",
  "hoglet:select",
  "system:error",
  "system:signal_arrived",
];

const ALL_MODES: VoiceMode[] = ["none", "pirate", "lolcat"];
const ALL_GENDERS: HogletGender[] = ["male", "female"];

const REGISTRY = buildRegistry();
const lastPlayedAt = new Map<VoiceIntent, number>();
const lastUrl = new Map<VoiceIntent, string>();

const THROTTLE_MS = 600;

let muted = false;
let volume = 0.7;
let currentMode: VoiceMode = "none";

export function setVoiceMuted(next: boolean): void {
  muted = next;
}

export function setVoiceVolume(next: number): void {
  volume = Math.max(0, Math.min(1, next));
}

export function setVoiceMode(next: VoiceMode): void {
  currentMode = next;
}

export function playVoice(
  intent: VoiceIntent,
  gender: HogletGender = "male",
): void {
  if (muted) return;

  // Fall back to baseline ("none") when the active mode has no clip for this
  // (intent, gender) — keeps fun modes ship-able incrementally without dead
  // spots.
  const modeBucket = REGISTRY[currentMode];
  const fallbackBucket = REGISTRY.none;
  const primary = modeBucket?.[gender]?.[intent] ?? [];
  const candidates =
    primary.length > 0 ? primary : (fallbackBucket?.[gender]?.[intent] ?? []);
  if (candidates.length === 0) {
    log.warn("No voice clips registered for intent/gender", {
      intent,
      gender,
      mode: currentMode,
    });
    return;
  }

  const now = Date.now();
  const last = lastPlayedAt.get(intent) ?? 0;
  if (now - last < THROTTLE_MS) return;

  const previous = lastUrl.get(intent);
  let url = candidates[Math.floor(Math.random() * candidates.length)];
  if (candidates.length > 1 && url === previous) {
    const idx = candidates.indexOf(url);
    url = candidates[(idx + 1) % candidates.length];
  }
  lastPlayedAt.set(intent, now);
  lastUrl.set(intent, url);

  try {
    const audio = new Audio(url);
    audio.volume = volume;
    audio.play().catch((error) => {
      log.warn("Voice play failed", { intent, error });
    });
  } catch (error) {
    log.warn("Voice play threw", { intent, error });
  }
}

type ModedRegistry = Record<
  VoiceMode,
  Record<HogletGender, Record<VoiceIntent, string[]>>
>;

function buildRegistry(): ModedRegistry {
  const emptyIntents = (): Record<VoiceIntent, string[]> => {
    const record = {} as Record<VoiceIntent, string[]>;
    for (const intent of ALL_INTENTS) record[intent] = [];
    return record;
  };
  const emptyGenders = (): Record<
    HogletGender,
    Record<VoiceIntent, string[]>
  > => {
    const record = {} as Record<HogletGender, Record<VoiceIntent, string[]>>;
    for (const gender of ALL_GENDERS) record[gender] = emptyIntents();
    return record;
  };
  const out: ModedRegistry = {} as ModedRegistry;
  for (const mode of ALL_MODES) out[mode] = emptyGenders();

  for (const [path, url] of Object.entries(voiceFiles)) {
    // Manifest entries look like `<mode>/<gender>/<unit>_<intent>_l<N>_t<N>.mp3`.
    const match = path.match(/^([^/]+)\/([^/]+)\/([^/]+_l\d+_t\d+\.mp3)$/);
    if (!match) continue;
    const [, modeSegment, genderSegment, filename] = match;
    const mode = modeSegment as VoiceMode;
    const gender = genderSegment as HogletGender;
    if (!ALL_MODES.includes(mode) || !ALL_GENDERS.includes(gender)) continue;
    const intentMatch = filename.match(/^(.+)_l\d+_t\d+\.mp3$/);
    if (!intentMatch) continue;
    const intent = intentMatch[1].replace(/^([^_]+)_/, "$1:") as VoiceIntent;
    if (intent in out[mode][gender]) out[mode][gender][intent].push(url);
  }
  return out;
}
