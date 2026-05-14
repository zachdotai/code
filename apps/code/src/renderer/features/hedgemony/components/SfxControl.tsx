import { Megaphone, MegaphoneSimple } from "@phosphor-icons/react";
import { useSfxStore } from "../audio/sfxStore";

export function SfxControl() {
  const muted = useSfxStore((s) => s.muted);
  const volume = useSfxStore((s) => s.volume);
  const toggleMute = useSfxStore((s) => s.toggleMute);
  const setVolume = useSfxStore((s) => s.setVolume);

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={toggleMute}
        className="flex h-7 w-7 items-center justify-center rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) text-(--gray-11) transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
        title={muted ? "Unmute voice/SFX" : "Mute voice/SFX"}
      >
        {muted ? <MegaphoneSimple size={14} /> : <Megaphone size={14} />}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={muted ? 0 : volume}
        onChange={(e) => {
          const val = Number(e.target.value);
          if (muted && val > 0) toggleMute();
          setVolume(val);
        }}
        className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-(--gray-5) accent-(--gray-11)"
        title={`Voice/SFX volume: ${volume}%`}
      />
    </div>
  );
}
