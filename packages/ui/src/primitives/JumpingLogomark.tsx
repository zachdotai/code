import { cn } from "@posthog/quill";
import Logo from "@posthog/ui/primitives/Logo";
import { type CSSProperties, useState } from "react";

// Sync with the 0.4s base in the logomark-jump animation in globals.css.
const LOGOMARK_AIRTIME_MS = 400;

interface JumpingLogomarkProps {
  className?: string;
}

interface LogomarkJumpStyle extends CSSProperties {
  "--logomark-jump-magnitude": number;
}

/**
 * The PostHog hog that springs up when clicked — rapid repeat clicks escalate the
 * jump. Mirrors the PostHog Cloud onboarding hero mascot. Size it via `className`
 * with the `[&_svg]:…` descendant utilities.
 */
export function JumpingLogomark({ className }: JumpingLogomarkProps) {
  const [lastJumped, setLastJumped] = useState<number | null>(() => Date.now());
  const [jumpIteration, setJumpIteration] = useState(0);

  const handleClick = () => {
    const now = Date.now();
    if (lastJumped && now - lastJumped < LOGOMARK_AIRTIME_MS) {
      return; // Don't interrupt an in-flight jump.
    }
    setJumpIteration(jumpIteration + 1);
    setLastJumped(null);
    requestAnimationFrame(() => setLastJumped(now));
  };

  return (
    <button
      type="button"
      aria-label="PostHog"
      className={cn(
        "w-fit cursor-pointer select-none",
        lastJumped && "animate-logomark-jump",
        className,
      )}
      style={
        {
          "--logomark-jump-magnitude": jumpIteration
            ? 1.5 ** ((jumpIteration % 8) - 2)
            : 1,
        } satisfies LogomarkJumpStyle as CSSProperties
      }
      onClick={handleClick}
    >
      <Logo wordmark={false} stacked={false} />
    </button>
  );
}
