import { Keyboard, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import { useHotkeys } from "react-hotkeys-hook";
import {
  HEDGEMONY_CONTEXT_LABELS,
  HEDGEMONY_CONTEXT_ORDER,
  HEDGEMONY_HOTKEYS,
  type HedgemonyHotkey,
  type HedgemonyHotkeyContext,
} from "../constants/hotkeys";

interface HedgemonyHotkeyHelperProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Highlighted in the overlay so the player sees what's bound *right now*. */
  activeContext?: HedgemonyHotkeyContext | null;
}

const KEY_LABELS: Record<string, string> = {
  mod: "⌘",
  ctrl: "Ctrl",
  shift: "⇧",
  alt: "⌥",
  enter: "↵",
  escape: "Esc",
  esc: "Esc",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  "/": "/",
};

function prettyKey(part: string): string {
  const trimmed = part.trim().toLowerCase();
  return KEY_LABELS[trimmed] ?? trimmed.toUpperCase();
}

function firstHotkey(keys: string): string {
  // For multi-binding strings like "w,a,s,d" pick the first stroke; for combos
  // like "shift+1" keep the whole stroke.
  const first = keys.split(",")[0].trim();
  return first;
}

function HotkeyChip({ keys }: { keys: string }) {
  const stroke = firstHotkey(keys);
  const parts = stroke.split("+");
  return (
    <span className="flex items-center gap-0.5">
      {parts.map((p) => (
        <kbd
          key={`${stroke}::${p}`}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-(--gray-6) bg-(--gray-2) px-1 font-mono text-(--gray-12) text-[10px] leading-none"
        >
          {prettyKey(p)}
        </kbd>
      ))}
    </span>
  );
}

function HotkeyRow({ hotkey }: { hotkey: HedgemonyHotkey }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-(--gray-11) text-[11px] leading-tight">
        {hotkey.description}
      </span>
      <HotkeyChip keys={hotkey.keys} />
    </div>
  );
}

export function HedgemonyHotkeyHelper({
  open,
  onOpenChange,
  activeContext,
}: HedgemonyHotkeyHelperProps) {
  // `?` opens, Esc closes — Esc is also wired in the map-level handler, but
  // we register it locally so the helper closes even when the map's Esc
  // ladder would have done something else first.
  useHotkeys(
    "shift+/",
    () => onOpenChange(!open),
    { enableOnFormTags: false, preventDefault: true },
    [open, onOpenChange],
  );
  useHotkeys(
    "escape",
    () => onOpenChange(false),
    { enabled: open, enableOnFormTags: true, preventDefault: false },
    [open, onOpenChange],
  );

  const grouped = HEDGEMONY_CONTEXT_ORDER.map((ctx) => ({
    ctx,
    items: HEDGEMONY_HOTKEYS.filter((h) => h.context === ctx),
  })).filter((g) => g.items.length > 0);

  // Hide the floating launcher whenever something is selected — its position
  // collides with the close button on the detail/command panels. The `?`
  // shortcut still opens the helper from the keyboard.
  const showLauncher = !activeContext;

  return (
    <>
      {showLauncher && (
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          title="Show hedgemony shortcuts (?)"
          aria-label="Show hedgemony shortcuts"
          className="absolute top-3 right-3 z-10 flex h-8 items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2)/85 px-2 text-(--gray-11) text-[12px] backdrop-blur-sm transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
        >
          <Keyboard size={14} />
          <span className="font-mono text-[12px]">?</span>
        </button>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            key="hedgemony-hotkey-helper"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute top-12 right-3 z-20 w-[320px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-(--radius-3) border border-(--gray-6) bg-(--gray-1) shadow-lg"
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenuCapture={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-2 border-(--accent-a5) border-b bg-[linear-gradient(180deg,var(--accent-a3)_0%,transparent_100%)] px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Keyboard size={14} className="text-(--accent-11)" />
                <span className="font-semibold text-(--gray-12) text-[12px]">
                  Hedgemony shortcuts
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="flex h-6 w-6 items-center justify-center rounded-(--radius-2) text-(--gray-10) hover:bg-(--accent-a3) hover:text-(--accent-11)"
                title="Close (Esc)"
                aria-label="Close shortcuts"
              >
                <X size={12} />
              </button>
            </header>
            <div className="scrollbar-overlay-y max-h-[60vh] overflow-y-auto px-3 py-2">
              {grouped.map((group) => {
                const isActive = group.ctx === activeContext;
                return (
                  <section
                    key={group.ctx}
                    className={`mb-2 rounded-(--radius-2) px-2 py-1.5 last:mb-0 ${
                      isActive
                        ? "border border-(--accent-7) bg-(--accent-a2)"
                        : "border border-transparent"
                    }`}
                  >
                    <h3 className="mb-1 font-mono text-(--accent-11) text-[9px] uppercase tracking-[0.18em]">
                      {HEDGEMONY_CONTEXT_LABELS[group.ctx]}
                      {isActive && (
                        <span className="ml-1 text-(--accent-11) text-[9px] normal-case tracking-normal">
                          · active
                        </span>
                      )}
                    </h3>
                    <div className="flex flex-col gap-0.5">
                      {group.items.map((hotkey) => (
                        <HotkeyRow key={hotkey.id} hotkey={hotkey} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
