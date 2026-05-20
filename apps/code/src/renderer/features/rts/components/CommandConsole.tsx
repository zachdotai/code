import { X } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

/**
 * Floating "command console" used by every hedgemony floating panel
 * (Builder, Hedgehouse, Nest, Hoglet, Spawn). One wrapper handles the slide-in
 * animation, the chamfered Starcraft-style chrome, and the consistent
 * header/body/footer layout — so every panel reads as part of the same HUD.
 *
 * `placement="bottom"` (default) anchors at bottom-center and slides up — the
 * legacy layout used by command-bar style panels. `placement="right"` anchors
 * as a full-height drawer on the right edge and slides in from the right —
 * used by the nest panel so its tall editor + hoglet list doesn't cover the
 * bottom-center brood orbits.
 */

const SLIDE_TRANSITION = {
  type: "spring" as const,
  damping: 26,
  stiffness: 280,
  mass: 0.6,
};

type Placement = "bottom" | "right";

interface CommandConsoleProps {
  /** Logical width preset. `wide` for detail panels, `compact` for command bars. */
  size?: "compact" | "wide" | "auto";
  /** Override max width (e.g. for variable detail panels). */
  width?: number | string;
  /** Anchoring side. `bottom` (default) for command bars, `right` for tall drawers. */
  placement?: Placement;
  /** Used as motion.div key so AnimatePresence transitions between instances. */
  consoleKey?: string;
  className?: string;
  style?: CSSProperties;
  /** Forwarded to the outer motion.div so callers can stopPropagation etc. */
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onContextMenuCapture?: (e: React.MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

const WIDTH_CLASS = {
  compact: "",
  wide: "w-[min(760px,calc(100vw-1.5rem))]",
  auto: "",
} as const;

const PLACEMENT_CLASS: Record<Placement, string> = {
  bottom: "-translate-x-1/2 absolute bottom-3 left-1/2 z-10 flex flex-col",
  right:
    "absolute top-3 right-3 bottom-3 z-10 flex w-[min(420px,38vw)] flex-col",
};

export function CommandConsole({
  size = "auto",
  width,
  placement = "bottom",
  consoleKey,
  className,
  style,
  onPointerDown,
  onContextMenuCapture,
  children,
}: CommandConsoleProps) {
  const initial =
    placement === "right" ? { x: 120, opacity: 0 } : { y: 120, opacity: 0 };
  const exit =
    placement === "right" ? { x: 120, opacity: 0 } : { y: 120, opacity: 0 };
  const animate =
    placement === "right" ? { x: 0, opacity: 1 } : { y: 0, opacity: 1 };
  const widthClass = placement === "right" ? "" : WIDTH_CLASS[size];
  // The rail accent runs along the side the panel slides in from: a top rail
  // for bottom-anchored panels, a left-edge vertical rail for right drawers.
  const railClass =
    placement === "right"
      ? "-translate-y-1/2 absolute top-1/2 left-0 h-[70%] w-px"
      : "-translate-x-1/2 absolute top-0 left-1/2 h-px w-[70%]";
  return (
    <motion.div
      key={consoleKey}
      initial={initial}
      animate={animate}
      exit={exit}
      transition={SLIDE_TRANSITION}
      onPointerDown={onPointerDown}
      onContextMenuCapture={onContextMenuCapture}
      className={`${PLACEMENT_CLASS[placement]} ${widthClass} ${className ?? ""}`}
      style={{ width, ...style }}
    >
      <div className="command-console-bevel-outer flex min-h-0 flex-auto flex-col">
        <div className="command-console-bevel-inner relative flex min-h-0 flex-auto flex-col">
          <div className={railClass}>
            <div className="command-console-rail h-full w-full" />
          </div>
          {children}
        </div>
      </div>
    </motion.div>
  );
}

interface HeaderProps {
  /** Small uppercase eyebrow (e.g. "Nest", "Hoglet"). */
  eyebrow?: ReactNode;
  /** Main title row. */
  title?: ReactNode;
  /** Optional secondary line under the title. */
  subtitle?: ReactNode;
  /** Trailing controls (badges, close X, etc.). Rendered right-aligned. */
  trailing?: ReactNode;
  /** Convenience: renders a close button in `trailing`. */
  onClose?: () => void;
  /** Disable the close button. */
  closeDisabled?: boolean;
  className?: string;
}

function Header({
  eyebrow,
  title,
  subtitle,
  trailing,
  onClose,
  closeDisabled,
  className,
}: HeaderProps) {
  return (
    <header
      className={`flex items-start justify-between gap-3 border-(--accent-a5) border-b bg-[linear-gradient(180deg,var(--accent-a3)_0%,transparent_100%)] px-4 py-2.5 ${className ?? ""}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {eyebrow && (
          <div className="font-mono text-(--accent-11) text-[10px] uppercase tracking-[0.18em]">
            {eyebrow}
          </div>
        )}
        {title && (
          <div className="truncate font-semibold text-(--gray-12) text-[14px] leading-tight">
            {title}
          </div>
        )}
        {subtitle && (
          <div className="text-(--gray-10) text-[11px] leading-snug">
            {subtitle}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {trailing}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            className="flex h-7 w-7 items-center justify-center rounded-(--radius-2) text-(--gray-10) hover:bg-(--accent-a3) hover:text-(--accent-11) disabled:opacity-40"
            title="Close (Esc)"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </header>
  );
}

interface BodyProps {
  /** When true, the body scrolls vertically and is allowed to shrink. */
  scroll?: boolean;
  className?: string;
  children: ReactNode;
}

function Body({ scroll, className, children }: BodyProps) {
  const base = "flex flex-col gap-3 px-4 py-3";
  const scrollClasses = scroll
    ? "min-h-0 flex-1 overflow-y-auto scrollbar-overlay-y"
    : "";
  return (
    <div className={`${base} ${scrollClasses} ${className ?? ""}`}>
      {children}
    </div>
  );
}

interface FooterProps {
  className?: string;
  /** Align buttons. Defaults to "end" (right-aligned actions). */
  align?: "start" | "center" | "end" | "between";
  children: ReactNode;
}

const ALIGN_CLASS = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
} as const;

function Footer({ className, align = "end", children }: FooterProps) {
  return (
    <div
      className={`flex items-center gap-2 border-(--accent-a5) border-t bg-[linear-gradient(0deg,var(--accent-a3)_0%,transparent_100%)] px-4 py-2.5 ${ALIGN_CLASS[align]} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

/**
 * Inline section split inside a row (Builder/Hedgehouse-style). Adds a vertical
 * accent divider to the left so the row reads as composed sub-panels rather
 * than a flat strip.
 */
interface SectionProps {
  /** Hide the leading accent divider (use on the first section). */
  noDivider?: boolean;
  className?: string;
  children: ReactNode;
}

function Section({ noDivider, className, children }: SectionProps) {
  return (
    <div
      className={`relative flex flex-col justify-center ${noDivider ? "" : "border-(--accent-a6) border-l pl-3"} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

CommandConsole.Header = Header;
CommandConsole.Body = Body;
CommandConsole.Footer = Footer;
CommandConsole.Section = Section;
