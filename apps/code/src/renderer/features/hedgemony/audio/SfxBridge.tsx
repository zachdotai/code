import { useEffect } from "react";
import { setSfxMuted, setSfxVolume } from "./sfx";
import { useSfxStore } from "./sfxStore";

export function SfxBridge() {
  const muted = useSfxStore((s) => s.muted);
  const volume = useSfxStore((s) => s.volume);

  useEffect(() => {
    setSfxMuted(muted);
  }, [muted]);

  useEffect(() => {
    setSfxVolume(volume / 100);
  }, [volume]);

  return null;
}
