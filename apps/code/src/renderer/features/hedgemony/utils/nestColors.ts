/**
 * Per-nest accent color derived deterministically from the nest id. Used to
 * visually link a hoglet's name chip back to its parent nest on the map — the
 * association is purely positional otherwise, which breaks down once two
 * nests sit close together. Saturation and lightness are fixed; only hue
 * varies, so the palette stays visually balanced.
 *
 * Amber hues are skipped because the default nest territory glow is amber —
 * a chip dot in the same hue would collide with the territory backdrop and
 * stop reading as "the chip's color says which nest."
 */

const SATURATION = 70;
const LIGHTNESS = 55;
const AMBER_BLOCK_START = 25;
const AMBER_BLOCK_END = 55;
const USABLE_HUE_SPAN = 360 - (AMBER_BLOCK_END - AMBER_BLOCK_START);

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function nestHue(nestId: string): number {
  const raw = hash(nestId) % USABLE_HUE_SPAN;
  return raw < AMBER_BLOCK_START
    ? raw
    : raw + (AMBER_BLOCK_END - AMBER_BLOCK_START);
}

export function nestAccentColor(nestId: string): string {
  return `hsl(${nestHue(nestId)}, ${SATURATION}%, ${LIGHTNESS}%)`;
}
