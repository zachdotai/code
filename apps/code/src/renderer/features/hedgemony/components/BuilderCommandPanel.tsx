import { Plus } from "@phosphor-icons/react";
import { motion } from "framer-motion";

interface BuilderCommandPanelProps {
  onBuildNest: () => void;
  onClose: () => void;
}

export function BuilderCommandPanel({
  onBuildNest,
  onClose,
}: BuilderCommandPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="-translate-x-1/2 absolute bottom-3 left-1/2 flex items-stretch gap-3 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) px-3 py-2 shadow-xl"
    >
      <div className="flex min-w-[120px] flex-col justify-center pr-3 text-[11px]">
        <span className="font-medium text-(--gray-12) text-[13px]">
          Builder
        </span>
        <span className="text-(--gray-10)">Right-click to move</span>
      </div>
      <div className="border-(--gray-5) border-l pl-3">
        <button
          type="button"
          onClick={onBuildNest}
          className="flex h-9 items-center gap-1.5 rounded-(--radius-2) border border-(--accent-7) bg-(--accent-3) px-3 font-medium text-(--accent-11) text-[12px] transition-colors hover:bg-(--accent-4) hover:text-(--accent-12)"
          title="Build a new nest"
        >
          <Plus size={14} />
          Build nest
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
