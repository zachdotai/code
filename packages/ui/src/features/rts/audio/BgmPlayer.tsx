import { CODE_RTS_ASSETS_BASE_URL, RTS_FLAG } from "@posthog/shared/constants";
import { useCommandCenterStore } from "@posthog/ui/features/command-center/commandCenterStore";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useAppView } from "@posthog/ui/router/useAppView";
import { logger } from "@posthog/ui/shell/logger";
import { useEffect, useRef } from "react";
import { useBgmStore } from "./bgmStore";

const log = logger.scope("rts-bgm");

const bgmUrl = `${import.meta.env.VITE_CODE_RTS_ASSETS_BASE_URL ?? CODE_RTS_ASSETS_BASE_URL}/bgm.mp3`;

export function BgmPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const muted = useBgmStore((s) => s.muted);
  const volume = useBgmStore((s) => s.volume);
  const viewType = useAppView().type;
  const viewMode = useCommandCenterStore((s) => s.viewMode);
  const rtsEnabled = useFeatureFlag(RTS_FLAG, import.meta.env.DEV);

  const shouldPlay =
    rtsEnabled && viewType === "command-center" && viewMode === "map";

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(bgmUrl);
      audioRef.current.loop = true;
    }
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : Math.max(0, Math.min(1, volume / 100));
  }, [muted, volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (shouldPlay) {
      audio.play().catch((error) => {
        log.warn("Bgm play failed", { error });
      });
    } else {
      audio.pause();
    }
  }, [shouldPlay]);

  return null;
}
