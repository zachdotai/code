/**
 * PROP ART — hand-coded SVG sprites, light from upper-left, shadows fall
 * lower-right. Each is a <g id="hm-NAME"> so <use href="#hm-NAME"> stamps
 * an instance. Render inside an <svg><defs>...</defs></svg>.
 */
export function MapBackdropDefs() {
  return (
    <>
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

      {/* OAK — deciduous, ~180px wide */}
      <g id="hm-oak">
        <ellipse cx="14" cy="48" rx="64" ry="16" fill="#000" opacity="0.22" />
        <path d="M-10 40 Q-12 56 -4 64 L8 64 Q14 56 10 40 Z" fill="#4f3520" />
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
        <ellipse cx="14" cy="36" rx="10" ry="8" fill="#1f3a26" opacity="0.45" />
      </g>

      {/* PINE — conifer, ~100px wide, ~190px tall */}
      <g id="hm-pine">
        <ellipse cx="6" cy="38" rx="40" ry="10" fill="#000" opacity="0.22" />
        <path d="M-4 36 L-7 50 L7 50 L4 36 Z" fill="#3a2716" />
        <path d="M0 -120 L-32 -50 L32 -50 Z" fill="#193624" />
        <path d="M0 -90 L-44 -10 Q-30 -5 0 -5 Q30 -5 44 -10 Z" fill="#21472e" />
        <path d="M0 -60 L-50 28 Q-30 35 0 35 Q30 35 50 28 Z" fill="#285537" />
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
        <ellipse cx="5" cy="32" rx="52" ry="11" fill="#000" opacity="0.22" />
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
        <ellipse cx="8" cy="-9" rx="9" ry="4" fill="#669454" opacity="0.6" />
      </g>

      {/* BOULDER cluster — ~130px wide */}
      <g id="hm-boulderLg">
        <ellipse cx="10" cy="38" rx="65" ry="13" fill="#000" opacity="0.22" />
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
        <ellipse cx="6" cy="-6" rx="9" ry="6" fill="#a9aca0" opacity="0.85" />
        <ellipse cx="10" cy="-8" rx="14" ry="5" fill="#578645" opacity="0.75" />
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
        <ellipse cx="-2" cy="-6" rx="3" ry="2" fill="#e26e60" opacity="0.7" />
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
    </>
  );
}
