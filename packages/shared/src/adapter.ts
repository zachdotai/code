/**
 * Every agent runtime this codebase can drive. "hog" (the pi distribution
 * wrapped by @posthog/harness) is local-only — cloud has no runtime for it.
 * This is the single source of truth for the union; import it instead of
 * redeclaring `"claude" | "codex"` (or `"claude" | "codex" | "hog"`) locally.
 */
export type Adapter = "claude" | "codex" | "hog";

/** Runtime values for {@link Adapter}, e.g. `z.enum(ADAPTER_VALUES)`. */
export const ADAPTER_VALUES = [
  "claude",
  "codex",
  "hog",
] as const satisfies readonly Adapter[];

/** The adapters selectable from the cloud sandbox. "hog" is local-only. */
export const CLOUD_ADAPTER_VALUES = [
  "claude",
  "codex",
] as const satisfies readonly Adapter[];

export type CloudAdapter = (typeof CLOUD_ADAPTER_VALUES)[number];

/** Maps a local-only adapter to its cloud fallback. "hog" has no cloud runtime. */
export function toCloudAdapter(adapter: Adapter): CloudAdapter {
  return adapter === "hog" ? "claude" : adapter;
}
