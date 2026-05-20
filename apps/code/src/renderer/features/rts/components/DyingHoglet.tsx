import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { playSfx } from "../audio/sfx";
import { useHogletStore } from "../stores/hogletStore";
import { AnimatedHedgehog } from "./AnimatedHedgehog";

const SPRITE_SIZE = 40;
const GHOST_RISE = -60;
const GHOST_DURATION = 1.2;

interface DyingHogletProps {
  hogletId: string;
  x: number;
  y: number;
}

type Phase = "death" | "ghost";

export function DyingHoglet({ hogletId, x, y }: DyingHogletProps) {
  const [phase, setPhase] = useState<Phase>("death");
  const finalizeDeath = useHogletStore((s) => s.finalizeDeath);

  useEffect(() => {
    playSfx("retire");
  }, []);

  const handleDeathComplete = useCallback(() => {
    setPhase("ghost");
  }, []);

  const handleGhostComplete = () => {
    finalizeDeath(hogletId);
  };

  return (
    <motion.div
      className="pointer-events-none absolute top-1/2 left-1/2"
      style={{ x, y }}
    >
      {phase === "death" && (
        <div className="-translate-x-1/2 -translate-y-1/2">
          <AnimatedHedgehog
            animation="death"
            fps={12}
            size={SPRITE_SIZE}
            loop={false}
            onComplete={handleDeathComplete}
          />
        </div>
      )}
      {phase === "ghost" && (
        <motion.div
          className="-translate-x-1/2 -translate-y-1/2"
          initial={{ y: 0, opacity: 1 }}
          animate={{ y: GHOST_RISE, opacity: 0 }}
          transition={{ duration: GHOST_DURATION, ease: "easeOut" }}
          onAnimationComplete={handleGhostComplete}
        >
          <AnimatedHedgehog
            animation="ghost"
            fps={10}
            size={SPRITE_SIZE}
            loop={true}
          />
        </motion.div>
      )}
    </motion.div>
  );
}
