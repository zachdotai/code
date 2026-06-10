import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

interface RtsFullscreenShellProps {
  fullscreen: boolean;
  /** True when any contextual UI is showing — we hide the explicit exit
   * button in that case to avoid overlapping the panel's own controls. */
  contextActive: boolean;
  onExitFullscreen: () => void;
  children: ReactNode;
}

/**
 * The fullscreen wrapper for the map. Portals into `document.body` so that
 * panels (which use `position: fixed`) sit above the z-1000 overlay rather
 * than getting clipped behind it. Outside fullscreen, just renders the map
 * inline.
 */
export function RtsFullscreenShell({
  fullscreen,
  contextActive,
  onExitFullscreen,
  children,
}: RtsFullscreenShellProps) {
  if (!fullscreen) {
    return <div className="relative h-full w-full">{children}</div>;
  }
  return createPortal(
    <motion.div
      key="rts-fullscreen"
      // `no-drag` is mandatory here: without it, even though the portal
      // visually covers the HeaderRow's `drag` region, the OS still
      // captures pointer events at the top of the screen for window
      // dragging, killing top-edge camera pan.
      className="no-drag fixed inset-0 z-1000 bg-(--gray-1)"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {children}
      {!contextActive && (
        <button
          type="button"
          onClick={onExitFullscreen}
          title="Exit fullscreen (Esc / F)"
          aria-label="Exit fullscreen"
          // Hidden whenever something is selected so it doesn't collide
          // with the detail panel's close / relocate buttons. Esc / F
          // still exits fullscreen from the keyboard.
          className="absolute top-3 right-16 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-(--gray-6) bg-(--gray-2)/80 text-(--gray-11) text-[16px] backdrop-blur-sm transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
        >
          ×
        </button>
      )}
      <FullscreenVignette />
    </motion.div>,
    document.body,
  );
}

function FullscreenVignette() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.18)_92%,rgba(0,0,0,0.34)_100%)]"
    />
  );
}
