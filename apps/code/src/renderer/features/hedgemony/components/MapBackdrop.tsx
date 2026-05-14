import type { Nest } from "@main/services/hedgemony/schemas";
import { useMemo } from "react";

const WORLD = 4000;
const HALF = WORLD / 2;
const GROUND = 16000;
const GROUND_HALF = GROUND / 2;

interface ZoneSpec {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  label: string;
  description: string;
  variant: "primary" | "muted";
  rotation: number;
}

const ZONES: ZoneSpec[] = [
  {
    id: "active",
    cx: 0,
    cy: 0,
    rx: 950,
    ry: 640,
    label: "Active nests",
    description: "goal territory",
    variant: "primary",
    rotation: -3,
  },
  {
    id: "wilds",
    cx: -1220,
    cy: 860,
    rx: 440,
    ry: 260,
    label: "Wilds",
    description: "ad-hoc hoglets",
    variant: "muted",
    rotation: 8,
  },
  {
    id: "staging",
    cx: 1180,
    cy: -820,
    rx: 450,
    ry: 270,
    label: "Signal staging",
    description: "unrouted signal work",
    variant: "muted",
    rotation: -6,
  },
];

type PropType =
  | "oak"
  | "pine"
  | "bush"
  | "bushLg"
  | "boulder"
  | "boulderLg"
  | "stump"
  | "wildflower"
  | "mushroom";

interface PropInstance {
  type: PropType;
  x: number;
  y: number;
  scale: number;
  flip: boolean;
}

/**
 * Sorted [threshold, type] pairs: walk in order, return the first whose
 * threshold the roll falls under. The trailing default catches `roll ≥` the
 * last threshold so every cell picks something. Tweaking the visual mix is a
 * matter of edit-the-table; the prior ternary cascades made that surgery.
 */
type PropWeights = readonly [number, PropType][];

const PROPS_IN_WILDS: PropWeights = [
  [0.42, "oak"],
  [0.68, "pine"],
  [0.82, "bushLg"],
  [0.9, "bush"],
  [0.95, "boulder"],
];
const PROPS_IN_WILDS_DEFAULT: PropType = "stump";

const PROPS_IN_STAGING: PropWeights = [
  [0.28, "boulder"],
  [0.5, "boulderLg"],
  [0.68, "pine"],
  [0.82, "oak"],
  [0.92, "stump"],
];
const PROPS_IN_STAGING_DEFAULT: PropType = "mushroom";

const PROPS_IN_ACTIVE: PropWeights = [
  [0.32, "wildflower"],
  [0.55, "bush"],
  [0.72, "bushLg"],
  [0.86, "oak"],
  [0.94, "mushroom"],
];
const PROPS_IN_ACTIVE_DEFAULT: PropType = "stump";

const PROPS_DEFAULT: PropWeights = [
  [0.3, "oak"],
  [0.54, "pine"],
  [0.7, "bushLg"],
  [0.8, "bush"],
  [0.87, "boulder"],
  [0.92, "boulderLg"],
  [0.96, "stump"],
  [0.99, "wildflower"],
];
const PROPS_DEFAULT_DEFAULT: PropType = "mushroom";

function pickProp(
  roll: number,
  weights: PropWeights,
  fallback: PropType,
): PropType {
  for (const [threshold, type] of weights) {
    if (roll < threshold) return type;
  }
  return fallback;
}

function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function insideEllipse(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy < 1;
}

function scatterProps(nests: Nest[]): PropInstance[] {
  const rng = makeRng(20251114);
  const out: PropInstance[] = [];
  const step = 195;
  for (let gy = -HALF + 110; gy < HALF - 110; gy += step) {
    for (let gx = -HALF + 110; gx < HALF - 110; gx += step) {
      const x = gx + (rng() - 0.5) * step * 1.4;
      const y = gy + (rng() - 0.5) * step * 1.4;
      if (Math.hypot(x, y) > HALF - 90) continue;
      if (Math.hypot(x, y) < 210) continue;
      if (rng() < 0.16) continue;
      const inActive = insideEllipse(x, y, 0, 0, 950, 640);
      if (inActive && rng() < 0.55) continue;
      if (nests.some((n) => Math.hypot(n.mapX - x, n.mapY - y) < 150)) continue;
      const inWilds = insideEllipse(x, y, -1220, 860, 440, 260);
      const inStaging = insideEllipse(x, y, 1180, -820, 450, 270);
      const roll = rng();
      const type = inWilds
        ? pickProp(roll, PROPS_IN_WILDS, PROPS_IN_WILDS_DEFAULT)
        : inStaging
          ? pickProp(roll, PROPS_IN_STAGING, PROPS_IN_STAGING_DEFAULT)
          : inActive
            ? pickProp(roll, PROPS_IN_ACTIVE, PROPS_IN_ACTIVE_DEFAULT)
            : pickProp(roll, PROPS_DEFAULT, PROPS_DEFAULT_DEFAULT);
      out.push({
        type,
        x,
        y,
        scale: 0.78 + rng() * 0.5,
        flip: rng() > 0.5,
      });
    }
  }
  // Painter's algorithm — things further "back" (lower y) render first.
  out.sort((a, b) => a.y - b.y);
  return out;
}

export function MapBackdrop({ nests }: { nests: Nest[] }) {
  const props = useMemo(() => scatterProps(nests), [nests]);

  return (
    <div
      className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2"
      style={{ width: GROUND, height: GROUND }}
    >
      <svg
        width={GROUND}
        height={GROUND}
        viewBox={`${-GROUND_HALF} ${-GROUND_HALF} ${GROUND} ${GROUND}`}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="block"
      >
        <defs>
          {/* Grass-blade noise — small repeating tile, stitched seamlessly */}
          <filter id="hm-grass-noise" x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="2"
              seed="3"
              stitchTiles="stitch"
            />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.14  0 0 0 0 0.28 0 0 0 0 0.14  0 0 0 0.20 0"
            />
          </filter>
          {/* Large-scale forest mottling — darker patches across the meadow */}
          <filter id="hm-forest-blobs" x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.0028"
              numOctaves="3"
              seed="11"
              stitchTiles="stitch"
            />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.14  0 0 0 0 0.32 0 0 0 0 0.16  0 0 0 0.32 -0.05"
            />
          </filter>
          <pattern
            id="hm-grass-pattern"
            x="0"
            y="0"
            width="500"
            height="500"
            patternUnits="userSpaceOnUse"
          >
            <rect
              x="0"
              y="0"
              width="500"
              height="500"
              filter="url(#hm-grass-noise)"
            />
          </pattern>
          <pattern
            id="hm-forest-pattern"
            x="0"
            y="0"
            width="2000"
            height="2000"
            patternUnits="userSpaceOnUse"
          >
            <rect
              x="0"
              y="0"
              width="2000"
              height="2000"
              filter="url(#hm-forest-blobs)"
            />
          </pattern>

          {/* Warm meadow wash at center */}
          <radialGradient id="hm-meadow" cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor="#e3edc8" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#a8c587" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#3a6638" stopOpacity="0" />
          </radialGradient>
          {/* Soft outer vignette to focus attention — scaled to keep darkening near the content boundary */}
          <radialGradient id="hm-vignette" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#000" stopOpacity="0" />
            <stop offset="16%" stopColor="#000" stopOpacity="0" />
            <stop offset="28%" stopColor="#0f1b10" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#0f1b10" stopOpacity="0.7" />
          </radialGradient>
          {/* Active-nests territory tint */}
          <radialGradient id="hm-zone-primary" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="#a3c98a" stopOpacity="0.34" />
            <stop offset="70%" stopColor="#a3c98a" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#a3c98a" stopOpacity="0" />
          </radialGradient>
          {/* Wilds / staging — darker, woodier */}
          <radialGradient id="hm-zone-muted" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="#2c4a2a" stopOpacity="0.5" />
            <stop offset="70%" stopColor="#2c4a2a" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#2c4a2a" stopOpacity="0" />
          </radialGradient>

          {/* =========================================================
              PROP ART — hand-coded SVG sprites, light from upper-left,
              shadows fall lower-right. Each is a <g id="hm-NAME"> so
              <use href="#hm-NAME"> stamps an instance.
          ============================================================ */}

          {/* OAK — deciduous, ~180px wide */}
          <g id="hm-oak">
            <ellipse
              cx="14"
              cy="48"
              rx="64"
              ry="16"
              fill="#000"
              opacity="0.22"
            />
            <path
              d="M-10 40 Q-12 56 -4 64 L8 64 Q14 56 10 40 Z"
              fill="#4f3520"
            />
            <path
              d="M-2 40 Q-3 55 1 64 L4 64 Q5 55 4 40 Z"
              fill="#6f4d2e"
              opacity="0.65"
            />
            <ellipse cx="2" cy="14" rx="76" ry="58" fill="#22422a" />
            <ellipse cx="-8" cy="2" rx="68" ry="50" fill="#37653b" />
            <ellipse cx="-22" cy="-8" rx="50" ry="38" fill="#588a4f" />
            <ellipse cx="-30" cy="-16" rx="32" ry="24" fill="#7caa68" />
            <ellipse
              cx="-36"
              cy="-22"
              rx="16"
              ry="12"
              fill="#9ec682"
              opacity="0.85"
            />
            <ellipse
              cx="32"
              cy="20"
              rx="14"
              ry="10"
              fill="#1f3a26"
              opacity="0.55"
            />
            <ellipse
              cx="14"
              cy="36"
              rx="10"
              ry="8"
              fill="#1f3a26"
              opacity="0.45"
            />
          </g>

          {/* PINE — conifer, ~100px wide, ~190px tall */}
          <g id="hm-pine">
            <ellipse
              cx="6"
              cy="38"
              rx="40"
              ry="10"
              fill="#000"
              opacity="0.22"
            />
            <path d="M-4 36 L-7 50 L7 50 L4 36 Z" fill="#3a2716" />
            <path d="M0 -120 L-32 -50 L32 -50 Z" fill="#193624" />
            <path
              d="M0 -90 L-44 -10 Q-30 -5 0 -5 Q30 -5 44 -10 Z"
              fill="#21472e"
            />
            <path
              d="M0 -60 L-50 28 Q-30 35 0 35 Q30 35 50 28 Z"
              fill="#285537"
            />
            <path
              d="M0 -120 L-32 -50 L-14 -50 Q-10 -88 0 -120 Z"
              fill="#3d7252"
              opacity="0.65"
            />
            <path
              d="M0 -90 L-44 -10 Q-32 -8 -12 -8 Q-8 -52 0 -90 Z"
              fill="#3d7252"
              opacity="0.5"
            />
            <path
              d="M0 -60 L-50 28 Q-30 32 -10 30 Q-8 -16 0 -60 Z"
              fill="#3d7252"
              opacity="0.4"
            />
            <circle cx="0" cy="-122" r="3.5" fill="#285537" />
          </g>

          {/* BUSH small — ~60px wide */}
          <g id="hm-bush">
            <ellipse cx="3" cy="18" rx="28" ry="6" fill="#000" opacity="0.22" />
            <ellipse cx="0" cy="2" rx="30" ry="22" fill="#2a4f30" />
            <ellipse cx="-6" cy="-4" rx="22" ry="16" fill="#477548" />
            <ellipse cx="-12" cy="-10" rx="12" ry="9" fill="#6b9968" />
            <ellipse
              cx="-14"
              cy="-14"
              rx="5"
              ry="4"
              fill="#94bb83"
              opacity="0.85"
            />
          </g>

          {/* BUSH large (flowering) — ~110px wide */}
          <g id="hm-bushLg">
            <ellipse
              cx="5"
              cy="32"
              rx="52"
              ry="11"
              fill="#000"
              opacity="0.22"
            />
            <ellipse cx="0" cy="6" rx="55" ry="38" fill="#28502f" />
            <ellipse cx="-10" cy="-4" rx="44" ry="30" fill="#447740" />
            <ellipse cx="-22" cy="-12" rx="28" ry="20" fill="#669f60" />
            <ellipse
              cx="-28"
              cy="-18"
              rx="14"
              ry="10"
              fill="#8fc079"
              opacity="0.85"
            />
            <circle cx="-30" cy="-10" r="2.4" fill="#fff" opacity="0.92" />
            <circle cx="-14" cy="-15" r="2" fill="#fff" opacity="0.92" />
            <circle cx="0" cy="-20" r="2.2" fill="#fff" opacity="0.92" />
            <circle cx="18" cy="-12" r="2" fill="#fff" opacity="0.92" />
            <circle cx="28" cy="0" r="2.4" fill="#fff" opacity="0.92" />
            <circle cx="20" cy="14" r="2" fill="#fff" opacity="0.92" />
            <circle cx="-5" cy="8" r="2" fill="#fff" opacity="0.92" />
            <circle cx="-18" cy="0" r="1.8" fill="#fff" opacity="0.92" />
          </g>

          {/* BOULDER — single mossy stone, ~80px wide */}
          <g id="hm-boulder">
            <ellipse cx="6" cy="26" rx="38" ry="9" fill="#000" opacity="0.22" />
            <ellipse cx="0" cy="0" rx="40" ry="28" fill="#56564f" />
            <ellipse cx="-6" cy="-6" rx="32" ry="22" fill="#75766d" />
            <ellipse cx="-12" cy="-12" rx="20" ry="14" fill="#929589" />
            <ellipse
              cx="-14"
              cy="-14"
              rx="8"
              ry="6"
              fill="#a9aca0"
              opacity="0.85"
            />
            <ellipse
              cx="-10"
              cy="-14"
              rx="12"
              ry="6"
              fill="#578645"
              opacity="0.78"
            />
            <ellipse
              cx="8"
              cy="-9"
              rx="9"
              ry="4"
              fill="#669454"
              opacity="0.6"
            />
          </g>

          {/* BOULDER cluster — ~130px wide */}
          <g id="hm-boulderLg">
            <ellipse
              cx="10"
              cy="38"
              rx="65"
              ry="13"
              fill="#000"
              opacity="0.22"
            />
            <ellipse cx="-22" cy="-2" rx="32" ry="22" fill="#52524b" />
            <ellipse cx="-28" cy="-8" rx="24" ry="16" fill="#72736a" />
            <ellipse cx="-32" cy="-12" rx="12" ry="9" fill="#929589" />
            <ellipse
              cx="-24"
              cy="-12"
              rx="14"
              ry="7"
              fill="#578645"
              opacity="0.75"
            />
            <ellipse cx="20" cy="10" rx="42" ry="28" fill="#56564f" />
            <ellipse cx="14" cy="2" rx="34" ry="22" fill="#75766d" />
            <ellipse cx="8" cy="-4" rx="22" ry="14" fill="#929589" />
            <ellipse
              cx="6"
              cy="-6"
              rx="9"
              ry="6"
              fill="#a9aca0"
              opacity="0.85"
            />
            <ellipse
              cx="10"
              cy="-8"
              rx="14"
              ry="5"
              fill="#578645"
              opacity="0.75"
            />
          </g>

          {/* STUMP — ~50px wide */}
          <g id="hm-stump">
            <ellipse cx="3" cy="16" rx="24" ry="5" fill="#000" opacity="0.22" />
            <path
              d="M-22 0 L-22 12 Q-18 16 0 16 Q22 16 22 12 L22 0 Q22 -4 0 -4 Q-22 -4 -22 0 Z"
              fill="#553820"
            />
            <path
              d="M0 16 Q22 16 22 12 L22 0 Q22 -2 18 -3 L18 12 Q14 14 0 14 Z"
              fill="#3b2614"
              opacity="0.7"
            />
            <ellipse cx="0" cy="0" rx="22" ry="7" fill="#a8835a" />
            <ellipse
              cx="0"
              cy="0"
              rx="16"
              ry="5"
              fill="none"
              stroke="#7d5e3a"
              strokeWidth="1.2"
            />
            <ellipse
              cx="0"
              cy="0"
              rx="10"
              ry="3.2"
              fill="none"
              stroke="#7d5e3a"
              strokeWidth="1"
            />
            <ellipse cx="0" cy="0" rx="4" ry="1.3" fill="#7d5e3a" />
            <path
              d="M-22 -1 Q-22 -3 -14 -4 Q-6 -3 -4 -1 Q-13 1 -22 -1 Z"
              fill="#578645"
              opacity="0.9"
            />
          </g>

          {/* WILDFLOWER patch — ~30px */}
          <g id="hm-wildflower">
            <path
              d="M-14 14 L-16 -2"
              stroke="#446e3e"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M-8 14 L-10 -4"
              stroke="#446e3e"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M-2 14 L-3 -6"
              stroke="#446e3e"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M4 14 L5 -4"
              stroke="#446e3e"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M10 14 L11 -2"
              stroke="#446e3e"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M14 14 L15 0"
              stroke="#446e3e"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path d="M-12 14 L-12 -7" stroke="#3a5e35" strokeWidth="1.2" />
            <path d="M0 14 L0 -11" stroke="#3a5e35" strokeWidth="1.2" />
            <path d="M8 14 L8 -9" stroke="#3a5e35" strokeWidth="1.2" />
            <circle cx="-12" cy="-8" r="2.8" fill="#f3c84a" />
            <circle cx="0" cy="-12" r="3.2" fill="#fff" />
            <circle cx="0" cy="-12" r="1.4" fill="#f3c84a" />
            <circle cx="8" cy="-10" r="2.8" fill="#fff" />
            <circle cx="8" cy="-10" r="1.2" fill="#f3c84a" />
          </g>

          {/* MUSHROOM cluster — ~28px */}
          <g id="hm-mushroom">
            <ellipse cx="2" cy="10" rx="14" ry="3" fill="#000" opacity="0.22" />
            <path d="M-2 8 Q-3 0 0 -2 Q3 0 2 8 Z" fill="#f0e3d0" />
            <ellipse cx="0" cy="-4" rx="8" ry="5" fill="#c93b2e" />
            <ellipse
              cx="-2"
              cy="-6"
              rx="3"
              ry="2"
              fill="#e26e60"
              opacity="0.7"
            />
            <circle cx="-3" cy="-5" r="1" fill="#fff" />
            <circle cx="2" cy="-6" r="1.2" fill="#fff" />
            <circle cx="3" cy="-3" r="0.7" fill="#fff" />
            <path d="M7 10 Q6 4 8 3 Q11 4 11 10 Z" fill="#f0e3d0" />
            <ellipse cx="9" cy="1" rx="5" ry="3" fill="#c93b2e" />
            <circle cx="7" cy="0" r="0.7" fill="#fff" />
            <circle cx="10.5" cy="-0.5" r="0.8" fill="#fff" />
            <path d="M-9 10 Q-9 6 -7 5 Q-5 6 -5 10 Z" fill="#f0e3d0" />
            <ellipse cx="-7" cy="3" rx="4" ry="2.4" fill="#c93b2e" />
            <circle cx="-8" cy="2" r="0.6" fill="#fff" />
          </g>
        </defs>

        {/* === GROUND LAYERS (fill the full extended area) === */}
        <rect
          x={-GROUND_HALF}
          y={-GROUND_HALF}
          width={GROUND}
          height={GROUND}
          fill="#436c41"
        />
        <rect
          x={-GROUND_HALF}
          y={-GROUND_HALF}
          width={GROUND}
          height={GROUND}
          fill="url(#hm-forest-pattern)"
          opacity="0.85"
        />
        <rect
          x={-HALF}
          y={-HALF}
          width={WORLD}
          height={WORLD}
          fill="url(#hm-meadow)"
        />
        <rect
          x={-GROUND_HALF}
          y={-GROUND_HALF}
          width={GROUND}
          height={GROUND}
          fill="url(#hm-grass-pattern)"
          opacity="0.45"
        />

        {/* === ZONE TINTS === */}
        {ZONES.map((z) => (
          <g
            key={z.id}
            transform={`translate(${z.cx} ${z.cy}) rotate(${z.rotation})`}
          >
            <ellipse
              cx="0"
              cy="0"
              rx={z.rx}
              ry={z.ry}
              fill={
                z.variant === "primary"
                  ? "url(#hm-zone-primary)"
                  : "url(#hm-zone-muted)"
              }
            />
          </g>
        ))}

        {/* === PROPS === */}
        {props.map((p) => (
          <use
            key={`${p.type}-${Math.round(p.x)}-${Math.round(p.y)}`}
            href={`#hm-${p.type}`}
            transform={`translate(${p.x} ${p.y}) scale(${p.flip ? -p.scale : p.scale} ${p.scale})`}
          />
        ))}

        {/* === VIGNETTE (covers full ground so edges stay dark) === */}
        <rect
          x={-GROUND_HALF}
          y={-GROUND_HALF}
          width={GROUND}
          height={GROUND}
          fill="url(#hm-vignette)"
        />
      </svg>

      {/* Zone labels rendered as DOM so text stays crisp under transform */}
      {ZONES.map((z) => (
        <div
          key={z.id}
          className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2"
          style={{
            transform: `translate(calc(-50% + ${z.cx - z.rx + 80}px), calc(-50% + ${z.cy - z.ry + 56}px))`,
          }}
        >
          <div
            className="font-medium text-[#f7f3e7] text-[12px] uppercase tracking-[0.18em]"
            style={{ textShadow: "0 2px 3px rgba(0,0,0,0.75)" }}
          >
            {z.label}
          </div>
          <div
            className="mt-0.5 text-[#f7f3e7]/85 text-[11px]"
            style={{ textShadow: "0 2px 3px rgba(0,0,0,0.7)" }}
          >
            {z.description}
          </div>
        </div>
      ))}
    </div>
  );
}
