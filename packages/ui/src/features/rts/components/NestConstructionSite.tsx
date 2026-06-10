import { motion } from "framer-motion";
import nestImage from "../../../assets/images/rts/nest.png";

interface NestConstructionSiteProps {
  mapX: number;
  mapY: number;
  /** Total construction window, matched to useBuilderCoordinator's
   * `buildAnimationMs` so the animation finishes exactly as the real
   * NestSprite is committed to the store. */
  durationMs: number;
}

const NEST_SIZE = 140;
const FOUNDATION_SIZE = 96;
const TWIG_WIDTH = 38;
const TWIG_HEIGHT = 6;

// Each twig flies in from a different direction (as if tossed by the builder
// from around the perimeter) and settles into a slot in the pile. The full
// set lands in a staggered sequence over the build window, so the user sees
// the nest accumulating beat by beat — not appearing all at once.
const TWIGS = [
  { fromX: -160, fromY: -70, toX: -22, toY: -8, fromRot: -55, toRot: -16 },
  { fromX: 150, fromY: -60, toX: 24, toY: -10, fromRot: 50, toRot: 14 },
  { fromX: 30, fromY: -160, toX: -6, toY: -16, fromRot: 25, toRot: -4 },
  { fromX: -140, fromY: 90, toX: -20, toY: 2, fromRot: -25, toRot: 10 },
  { fromX: 130, fromY: 100, toX: 18, toY: 4, fromRot: 40, toRot: -8 },
  { fromX: -10, fromY: 160, toX: -2, toY: 8, fromRot: -10, toRot: 2 },
];

export function NestConstructionSite({
  mapX,
  mapY,
  durationMs,
}: NestConstructionSiteProps) {
  const duration = durationMs / 1000;
  // The last twig should finish landing a touch before the timer fires so
  // there's a brief moment where the nest is "complete" before the real
  // sprite takes over.
  const lastLandingFraction = 0.85;
  const perTwigGap = lastLandingFraction / TWIGS.length;

  return (
    <motion.div
      className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2"
      style={{ x: mapX, y: mapY }}
    >
      <motion.div
        className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 rounded-full border-(--accent-9) border-2 border-dashed bg-(--accent-3)/20"
        style={{ width: FOUNDATION_SIZE, height: FOUNDATION_SIZE }}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{
          opacity: [0, 0.9, 0.9, 0],
          scale: [0.6, 1, 1, 1.08],
        }}
        transition={{
          duration,
          times: [0, 0.12, 0.88, 1],
          ease: "easeOut",
        }}
      />

      {TWIGS.map((twig, i) => {
        const landAt = perTwigGap * (i + 1);
        const enterAt = Math.max(0, landAt - 0.18);
        return (
          <motion.div
            key={`${twig.fromX}-${twig.fromY}`}
            className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 rounded-(--radius-2)"
            style={{
              width: TWIG_WIDTH,
              height: TWIG_HEIGHT,
              background: "linear-gradient(180deg, #b88458 0%, #6f4a2a 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.2)",
            }}
            initial={{
              x: twig.fromX,
              y: twig.fromY,
              rotate: twig.fromRot,
              opacity: 0,
            }}
            animate={{
              x: [twig.fromX, twig.fromX, twig.toX, twig.toX],
              y: [twig.fromY, twig.fromY, twig.toY, twig.toY],
              rotate: [twig.fromRot, twig.fromRot, twig.toRot, twig.toRot],
              opacity: [0, 1, 1, 1],
            }}
            transition={{
              duration,
              times: [0, enterAt, landAt, 1],
              ease: "easeIn",
            }}
          />
        );
      })}

      <motion.div
        className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 rounded-full bg-(--gray-12)/30 blur-sm"
        style={{
          width: NEST_SIZE - 36,
          height: 14,
          transform: "translateY(38px)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.3, 0.4] }}
        transition={{ duration, times: [0, 0.5, 1], ease: "easeOut" }}
      />

      <motion.img
        src={nestImage}
        alt=""
        className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 select-none drop-shadow-md"
        style={{ width: NEST_SIZE, height: NEST_SIZE }}
        draggable={false}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{
          opacity: [0, 0, 0.4, 1],
          scale: [0.7, 0.8, 0.95, 1],
        }}
        transition={{
          duration,
          times: [0, 0.25, 0.7, 1],
          ease: "easeOut",
        }}
      />
    </motion.div>
  );
}
