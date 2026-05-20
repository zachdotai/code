import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { useEffect } from "react";
import { setSfxMuted, setSfxVolume } from "./sfx";
import { useSfxStore } from "./sfxStore";
import { setVoiceMode, setVoiceMuted, setVoiceVolume } from "./voice";

export function SfxBridge() {
  const muted = useSfxStore((s) => s.muted);
  const volume = useSfxStore((s) => s.volume);
  const funMode = useSettingsStore((s) => s.funMode);

  useEffect(() => {
    setSfxMuted(muted);
    setVoiceMuted(muted);
  }, [muted]);

  useEffect(() => {
    setSfxVolume(volume / 100);
    setVoiceVolume(volume / 100);
  }, [volume]);

  useEffect(() => {
    setVoiceMode(funMode);
  }, [funMode]);

  return null;
}
