/**
 * Reads PostHog design tokens from the host `<html>` element so canvases can
 * style themselves with the same palette as the rest of the app. The iframe
 * runtime in `runtime.ts` injects these as CSS custom properties on the
 * iframe's `:root`, plus a JS `tokens` object on the runtime scope for the
 * cases where `var(...)` doesn't fit (e.g. Chart.js series colors).
 *
 * Modeled after `features/mcp-apps/utils/mcp-app-theme.ts` — same pattern, but
 * trimmed to the surface canvases actually need.
 */

export interface CanvasTokens {
  cssVars: Record<string, string>;
  fontSans: string;
  isDark: boolean;
}

function getVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function readScale(prefix: string, count: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 1; i <= count; i++) {
    const value = getVar(`--${prefix}-${i}`);
    if (value) out[`--${prefix}-${i}`] = value;
  }
  return out;
}

const RADIUS_FALLBACKS: Record<string, string> = {
  "--radius-1": "3px",
  "--radius-2": "4px",
  "--radius-3": "6px",
  "--radius-4": "8px",
  "--radius-5": "12px",
  "--radius-6": "16px",
};

const FONT_SIZE_FALLBACKS: Record<string, string> = {
  "--font-size-1": "12px",
  "--font-size-2": "14px",
  "--font-size-3": "16px",
  "--font-size-4": "18px",
  "--font-size-5": "20px",
  "--font-size-6": "24px",
};

export function buildCanvasTokens(): CanvasTokens {
  const cssVars: Record<string, string> = {
    ...readScale("gray", 12),
    ...readScale("orange", 12),
    ...readScale("red", 12),
    ...readScale("green", 12),
    ...readScale("blue", 12),
    ...readScale("yellow", 12),
    ...readScale("accent", 12),
  };

  for (const [name, fallback] of Object.entries(RADIUS_FALLBACKS)) {
    cssVars[name] = getVar(name) || fallback;
  }
  for (const [name, fallback] of Object.entries(FONT_SIZE_FALLBACKS)) {
    cssVars[name] = getVar(name) || fallback;
  }

  const fontSans =
    getVar("--default-font-family") ||
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
  cssVars["--font-sans"] = fontSans;

  const isDark = document.documentElement.classList.contains("dark");

  return { cssVars, fontSans, isDark };
}
