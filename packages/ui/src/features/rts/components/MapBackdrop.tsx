import type { Nest } from "@posthog/host-router/rts-schemas";
import { useMemo } from "react";
import { MapBackdropDefs } from "./mapBackdrop/props";
import { scatterProps } from "./mapBackdrop/scatter";
import { ZONES } from "./mapBackdrop/zones";

const WORLD = 4000;
const HALF = WORLD / 2;
const GROUND = 16000;
const GROUND_HALF = GROUND / 2;

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
          <MapBackdropDefs />
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
    </div>
  );
}
