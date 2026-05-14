import { MusicNotes } from "@phosphor-icons/react";
import { useBgmStore } from "../audio/bgmStore";

export function BgmControl() {
  const muted = useBgmStore((s) => s.muted);
  const volume = useBgmStore((s) => s.volume);
  const toggleMute = useBgmStore((s) => s.toggleMute);
  const setVolume = useBgmStore((s) => s.setVolume);

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={toggleMute}
        className="flex h-7 w-7 items-center justify-center rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) text-(--gray-11) transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
        title={muted ? "Unmute music" : "Mute music"}
      >
        <MusicNotes size={14} className={muted ? "opacity-40" : undefined} />
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
        title={`Volume: ${volume}%`}
      />
    </div>
  );
}
