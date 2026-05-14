import type { HogletGender } from "@main/services/hedgemony/hoglet-names";
import { logger } from "@utils/logger";

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

const voiceFiles = import.meta.glob<string>(
  "@renderer/assets/sounds/voice/**/*.wav",
  { eager: true, query: "?url", import: "default" },
);

const lastPlayedAt = new Map<VoiceIntent, number>();
const lastUrl = new Map<VoiceIntent, string>();

const THROTTLE_MS = 600;

let muted = false;
let volume = 0.7;

export function setVoiceMuted(next: boolean): void {
  muted = next;
}

export function setVoiceVolume(next: number): void {
  volume = Math.max(0, Math.min(1, next));
}

export function playVoice(
  intent: VoiceIntent,
  gender: HogletGender = "male",
): void {
  if (muted) return;
  const genderBucket = REGISTRY[gender];
  const candidates = genderBucket?.[intent];
  if (!candidates || candidates.length === 0) {
    log.warn("No voice clips registered for intent/gender", { intent, gender });
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

type GenderedRegistry = Record<HogletGender, Record<VoiceIntent, string[]>>;

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

function buildRegistry(): GenderedRegistry {
  const empty = (): Record<VoiceIntent, string[]> => {
    const record = {} as Record<VoiceIntent, string[]>;
    for (const intent of ALL_INTENTS) record[intent] = [];
    return record;
  };
  const out: GenderedRegistry = {
    male: empty(),
    female: empty(),
  };
  for (const [path, url] of Object.entries(voiceFiles)) {
    const gender: HogletGender = path.includes("/female/") ? "female" : "male";
    const filename = path.split("/").pop() ?? "";
    const match = filename.match(/^(.+)_l\d+_t\d+\.wav$/);
    if (!match) continue;
    const intent = match[1].replace(/^([^_]+)_/, "$1:") as VoiceIntent;
    if (intent in out[gender]) out[gender][intent].push(url);
  }
  return out;
}

const REGISTRY = buildRegistry();
