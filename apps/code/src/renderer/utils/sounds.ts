import {
  type CompletionSound,
  useSettingsStore,
} from "@features/settings/stores/settingsStore";
import bubblesUrl from "@renderer/assets/sounds/bubbles.mp3";
import daniloUrl from "@renderer/assets/sounds/danilo.mp3";
import dropUrl from "@renderer/assets/sounds/drop.mp3";
import guitarUrl from "@renderer/assets/sounds/guitar.mp3";
import knockUrl from "@renderer/assets/sounds/knock.mp3";
import meepUrl from "@renderer/assets/sounds/meep.mp3";
import reviUrl from "@renderer/assets/sounds/revi.mp3";
import ringUrl from "@renderer/assets/sounds/ring.mp3";
import shootUrl from "@renderer/assets/sounds/shoot.mp3";
import slideUrl from "@renderer/assets/sounds/slide.mp3";
import switchUrl from "@renderer/assets/sounds/switch.mp3";
import wilhelmUrl from "@renderer/assets/sounds/wilhelm.mp3";
import { logger } from "@utils/logger";

const SOUND_URLS: Record<
  Exclude<CompletionSound, "none" | "custom">,
  string
> = {
  guitar: guitarUrl,
  danilo: daniloUrl,
  revi: reviUrl,
  meep: meepUrl,
  bubbles: bubblesUrl,
  drop: dropUrl,
  knock: knockUrl,
  ring: ringUrl,
  shoot: shootUrl,
  slide: slideUrl,
  switch: switchUrl,
  wilhelm: wilhelmUrl,
};

const log = logger.scope("sounds");

let currentAudio: HTMLAudioElement | null = null;

export function playCompletionSound(sound: CompletionSound, volume = 80): void {
  if (sound === "none") return;

  const url =
    sound === "custom"
      ? useSettingsStore.getState().customCompletionSound
      : SOUND_URLS[sound];
  if (!url) {
    log.warn("No URL for completion sound", { sound });
    return;
  }

  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  const audio = new Audio(url);
  audio.volume = Math.max(0, Math.min(100, volume)) / 100;
  audio.addEventListener("error", () => {
    log.error("Audio element error", {
      sound,
      code: audio.error?.code,
      message: audio.error?.message,
    });
  });
  currentAudio = audio;
  audio.play().catch((error) => {
    log.error("audio.play() rejected", { sound, error: String(error) });
  });
  audio.addEventListener("ended", () => {
    if (currentAudio === audio) {
      currentAudio = null;
    }
  });
}
