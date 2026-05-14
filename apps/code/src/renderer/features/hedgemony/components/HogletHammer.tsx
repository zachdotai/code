import { motion } from "framer-motion";

interface HogletHammerProps {
  size?: number;
  animate?: boolean;
}

export function HogletHammer({ size = 18, animate = true }: HogletHammerProps) {
  return (
    <motion.svg
      role="img"
      aria-label="Working"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      style={{ transformOrigin: "4px 12px" }}
      animate={animate ? { rotate: [-18, 8, -18] } : { rotate: 0 }}
      transition={
        animate
          ? { duration: 0.6, repeat: Infinity, ease: "easeInOut" }
          : undefined
      }
    >
      <title>Working</title>
      <rect x="9" y="1" width="5" height="4" fill="#9a9a9a" />
      <rect x="9" y="1" width="5" height="1" fill="#c4c4c4" />
      <rect x="9" y="4" width="5" height="1" fill="#5a5a5a" />
      <rect x="3" y="6" width="9" height="2" fill="#a06b3a" />
      <rect x="3" y="6" width="9" height="1" fill="#c4884a" />
      <rect x="3" y="8" width="9" height="1" fill="#6b4520" />
    </motion.svg>
  );
}
