import { Plus } from "@phosphor-icons/react";
import { motion } from "framer-motion";

interface HedgehouseCommandPanelProps {
  onSpawnWildHog: () => void;
  onClose: () => void;
}

export function HedgehouseCommandPanel({
  onSpawnWildHog,
  onClose,
}: HedgehouseCommandPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="-translate-x-1/2 absolute bottom-3 left-1/2 z-10 flex items-stretch gap-3 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) px-3 py-2 shadow-xl"
    >
      <div className="flex min-w-[140px] flex-col justify-center pr-3 text-[11px]">
        <span className="font-medium text-(--gray-12) text-[13px]">
          Hedgehouse
        </span>
        <span className="text-(--gray-10)">Town hall of the wilds</span>
      </div>
      <div className="flex items-center gap-2 border-(--gray-5) border-l pl-3">
        <button
          type="button"
          onClick={onSpawnWildHog}
          className="flex h-9 items-center gap-1.5 rounded-(--radius-2) border border-(--accent-7) bg-(--accent-3) px-3 font-medium text-(--accent-11) text-[12px] transition-colors hover:bg-(--accent-4) hover:text-(--accent-12)"
          title="Dispatch a one-off agent from the Hedgehouse"
        >
          <Plus size={14} />
          Spawn wild hog
        </button>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="self-start text-(--gray-9) text-[11px] hover:text-(--gray-12)"
        title="Deselect (Esc)"
      >
        Esc
      </button>
    </motion.div>
  );
}
