/**
 * Human-readable "time since" formatter for federation rows. Stays local to
 * the federation subsection so the rest of hedgemony doesn't grow an
 * additional time-formatting dependency.
 */
export function formatRelativeTime(
  iso: string,
  now: number = Date.now(),
): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const diffMs = now - then;
  if (diffMs < 0) return "just now";
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(days / 365);
  return `${years}y ago`;
}
