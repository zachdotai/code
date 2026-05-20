import { useCommandCenterStore } from "@features/command-center/stores/commandCenterStore";
import { useFeatureFlag } from "@hooks/useFeatureFlag";
import { RTS_FLAG } from "@shared/constants";
import { useNavigationStore } from "@stores/navigationStore";
import { useEffect, useRef } from "react";
import { useBgmStore } from "./bgmStore";

const bgmUrl =
  import.meta.env.VITE_CODE_RTS_BGM_URL ??
  "https://posthog.com/code-rts/bgm.mp3";

export function BgmPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const muted = useBgmStore((s) => s.muted);
  const volume = useBgmStore((s) => s.volume);
  const viewType = useNavigationStore((s) => s.view.type);
  const viewMode = useCommandCenterStore((s) => s.viewMode);
  const hedgemonyEnabled = useFeatureFlag(RTS_FLAG, import.meta.env.DEV);

  const shouldPlay =
    hedgemonyEnabled && viewType === "command-center" && viewMode === "map";

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(bgmUrl);
      audioRef.current.loop = true;
    }
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
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [shouldPlay]);

  return null;
}
