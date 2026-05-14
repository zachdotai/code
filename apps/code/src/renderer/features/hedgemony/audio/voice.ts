import { logger } from "@utils/logger";

const log = logger.scope("hedgemony-voice");

export type VoiceIntent =
  | "hoglet:select"
  | "hoglet:order_move"
  | "hedgehog:goal_complete";

// Vite resolves this glob at build time into a record of asset URLs, so the
// runtime never deals with disk paths. Filenames follow the convention
// `<unit>_<intent>_l<line>_t<take>.wav` (intent may contain underscores).
const voiceFiles = import.meta.glob<string>(
  "@renderer/assets/sounds/voice/*.wav",
  { eager: true, query: "?url", import: "default" },
);

const REGISTRY = buildRegistry();
const lastPlayedAt = new Map<VoiceIntent, number>();
const lastUrl = new Map<VoiceIntent, string>();

// Voice gets annoying fast if you fire on every event in a burst. Match the
// chirp's typical gap rather than letting two barks overlap.
const THROTTLE_MS = 600;

let muted = false;
let volume = 0.7;

export function setVoiceMuted(next: boolean): void {
  muted = next;
}

export function setVoiceVolume(next: number): void {
  volume = Math.max(0, Math.min(1, next));
}

export function playVoice(intent: VoiceIntent): void {
  if (muted) return;
  const candidates = REGISTRY[intent];
  if (!candidates || candidates.length === 0) {
    log.warn("No voice clips registered for intent", { intent });
    return;
  }

  const now = Date.now();
  const last = lastPlayedAt.get(intent) ?? 0;
  if (now - last < THROTTLE_MS) return;

  const previous = lastUrl.get(intent);
  let url = candidates[Math.floor(Math.random() * candidates.length)];
  // Avoid playing the same clip twice in a row when alternatives exist.
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

function buildRegistry(): Record<VoiceIntent, string[]> {
  const out: Record<VoiceIntent, string[]> = {
    "hoglet:select": [],
    "hoglet:order_move": [],
    "hedgehog:goal_complete": [],
  };
  for (const [path, url] of Object.entries(voiceFiles)) {
    const filename = path.split("/").pop() ?? "";
    // Strip the `_l<n>_t<n>.wav` suffix; whatever's left is `<unit>_<intent>`.
    const match = filename.match(/^(.+)_l\d+_t\d+\.wav$/);
    if (!match) continue;
    const intent = match[1].replace(/^([^_]+)_/, "$1:") as VoiceIntent;
    if (intent in out) out[intent].push(url);
  }
  return out;
}
