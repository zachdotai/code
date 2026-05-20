import { motion } from "framer-motion";
import { AnimatedHedgehog } from "./AnimatedHedgehog";

interface MoneyHedgehogProps {
  size?: number;
  className?: string;
}

/**
 * Hedgehog-mode idle hedgehog dressed up for FinOps — a tophat sitting on its
 * head, a sack of coins to the side, and a few twinkling sparkles. The base
 * character comes from the vendored sprite atlas via `AnimatedHedgehog`; the
 * accessories are inline SVG layered on top because the atlas has no banker
 * skin or money-bag accessory.
 */
export function MoneyHedgehog({ size = 120, className }: MoneyHedgehogProps) {
  const tophatWidth = size * 0.42;
  const tophatHeight = size * 0.34;
  const tophatTop = size * 0.04;

  const bagSize = size * 0.4;
  const bagBottom = size * 0.04;
  const bagRight = -size * 0.04;

  return (
    <div
      className={`relative ${className ?? ""}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <AnimatedHedgehog animation="idle" size={size} />

      {/* Tophat — pixel-art-styled SVG sitting on the hedgehog's head */}
      <svg
        className="-translate-x-1/2 pointer-events-none absolute left-1/2"
        style={{ top: tophatTop, width: tophatWidth, height: tophatHeight }}
        viewBox="-50 -50 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>Tophat</title>
        {/* Brim */}
        <rect x="-38" y="14" width="76" height="8" fill="#0d0d0d" />
        <rect x="-38" y="14" width="76" height="2" fill="#3a3a3a" />
        {/* Crown */}
        <rect x="-22" y="-36" width="44" height="50" fill="#1a1a1a" />
        <rect x="-22" y="-36" width="44" height="6" fill="#3a3a3a" />
        {/* Gold band */}
        <rect x="-22" y="6" width="44" height="6" fill="#d4a13a" />
        <rect
          x="-22"
          y="6"
          width="44"
          height="2"
          fill="#f3c84a"
          opacity="0.9"
        />
        <circle cx="0" cy="9" r="2" fill="#f3c84a" />
      </svg>

      {/* Money bag — beige sack, tied at the top, with a bold $ */}
      <motion.div
        className="pointer-events-none absolute"
        style={{
          right: bagRight,
          bottom: bagBottom,
          width: bagSize,
          height: bagSize,
        }}
        initial={{ rotate: -6 }}
        animate={{ rotate: [-6, 4, -6] }}
        transition={{
          duration: 3.2,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox="-50 -50 100 100"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Bag of money</title>
          {/* Ground shadow */}
          <ellipse cx="0" cy="42" rx="32" ry="4" fill="#000" opacity="0.35" />
          {/* Sack body */}
          <path
            d="M-28 -10 Q-36 12 -28 30 Q-16 42 0 42 Q16 42 28 30 Q36 12 28 -10 Q22 -16 12 -18 L-12 -18 Q-22 -16 -28 -10 Z"
            fill="#c8a878"
          />
          {/* Body highlight */}
          <path
            d="M-22 0 Q-26 14 -18 26 Q-10 32 -2 30"
            stroke="#dcbb8e"
            strokeWidth="6"
            strokeLinecap="round"
            fill="none"
            opacity="0.7"
          />
          {/* Cinched neck */}
          <path
            d="M-14 -22 Q0 -16 14 -22 L18 -10 Q0 -6 -18 -10 Z"
            fill="#a47e4a"
          />
          {/* Tie cord */}
          <path
            d="M-10 -26 Q0 -22 10 -26"
            stroke="#5a3a18"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
          {/* Bold $ on the front */}
          <text
            x="0"
            y="22"
            textAnchor="middle"
            fontFamily="Georgia, serif"
            fontWeight="bold"
            fontSize="32"
            fill="#7a5722"
          >
            $
          </text>
        </svg>
      </motion.div>

      {/* Sparkles — twinkle around the bag */}
      <Sparkle x={size * 0.78} y={size * 0.32} delay={0} />
      <Sparkle x={size * 0.94} y={size * 0.58} delay={0.6} />
      <Sparkle x={size * 0.6} y={size * 0.18} delay={1.2} />
    </div>
  );
}

function Sparkle({ x, y, delay }: { x: number; y: number; delay: number }) {
  return (
    <motion.svg
      className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute"
      style={{ left: x, top: y, width: 12, height: 12 }}
      viewBox="-10 -10 20 20"
      xmlns="http://www.w3.org/2000/svg"
      initial={{ opacity: 0, scale: 0.4, rotate: 0 }}
      animate={{
        opacity: [0, 1, 0],
        scale: [0.4, 1.2, 0.4],
        rotate: [0, 90, 180],
      }}
      transition={{
        duration: 1.6,
        repeat: Number.POSITIVE_INFINITY,
        ease: "easeInOut",
        delay,
      }}
    >
      <title>Sparkle</title>
      <path
        d="M0 -9 L2 -2 L9 0 L2 2 L0 9 L-2 2 L-9 0 L-2 -2 Z"
        fill="#f3c84a"
      />
      <path
        d="M0 -4 L1 -1 L4 0 L1 1 L0 4 L-1 1 L-4 0 L-1 -1 Z"
        fill="#fff5cc"
      />
    </motion.svg>
  );
}
