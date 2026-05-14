import nestImage from "@renderer/assets/images/hedgemony/nest.png";
import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { playSfx } from "../audio/sfx";
import { useNestStore } from "../stores/nestStore";
import { AnimatedHedgehog } from "./AnimatedHedgehog";

const NEST_SIZE = 140;
const FIRE_SIZE = 80;
const BURN_DURATION = 1.4;
const COLLAPSE_DURATION = 0.8;

interface DyingNestProps {
  nestId: string;
  x: number;
  y: number;
}

type Phase = "burning" | "collapse";

export function DyingNest({ nestId, x, y }: DyingNestProps) {
  const [phase, setPhase] = useState<Phase>("burning");
  const finalizeDying = useNestStore((s) => s.finalizeDying);

  useEffect(() => {
    playSfx("retire");
  }, []);

  useEffect(() => {
    if (phase !== "burning") return;
    const timer = setTimeout(() => setPhase("collapse"), BURN_DURATION * 1000);
    return () => clearTimeout(timer);
  }, [phase]);

  const handleCollapseComplete = useCallback(() => {
    finalizeDying(nestId);
  }, [finalizeDying, nestId]);

  return (
    <motion.div
      className="pointer-events-none absolute top-1/2 left-1/2"
      style={{ x, y }}
    >
      {phase === "burning" && (
        <div className="-translate-x-1/2 -translate-y-1/2">
          <div
            className="relative"
            style={{ width: NEST_SIZE, height: NEST_SIZE }}
          >
            <motion.img
              src={nestImage}
              alt=""
              className="pointer-events-none absolute inset-0 select-none drop-shadow-md"
              style={{ width: NEST_SIZE, height: NEST_SIZE }}
              draggable={false}
              animate={{
                filter: [
                  "brightness(1) saturate(1)",
                  "brightness(1.3) saturate(0.6)",
                  "brightness(1.5) saturate(0.3)",
                ],
              }}
              transition={{ duration: BURN_DURATION, ease: "easeIn" }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <AnimatedHedgehog
                animation="fire"
                fps={14}
                size={FIRE_SIZE}
                loop={true}
              />
            </div>
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ mixBlendMode: "screen" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.4, 0.6] }}
              transition={{ duration: BURN_DURATION, ease: "easeIn" }}
              aria-hidden
            >
              <div
                className="h-full w-full rounded-full"
                style={{
                  background:
                    "radial-gradient(circle, rgba(255, 140, 50, 0.5) 0%, rgba(255, 80, 20, 0.3) 50%, transparent 75%)",
                }}
              />
            </motion.div>
          </div>
        </div>
      )}
      {phase === "collapse" && (
        <motion.div
          className="-translate-x-1/2 -translate-y-1/2"
          initial={{ opacity: 1, scale: 1 }}
          animate={{ opacity: 0, scale: 0.3, y: 20 }}
          transition={{ duration: COLLAPSE_DURATION, ease: "easeIn" }}
          onAnimationComplete={handleCollapseComplete}
        >
          <div
            className="relative"
            style={{ width: NEST_SIZE, height: NEST_SIZE }}
          >
            <img
              src={nestImage}
              alt=""
              className="pointer-events-none absolute inset-0 select-none"
              style={{
                width: NEST_SIZE,
                height: NEST_SIZE,
                filter: "brightness(1.5) saturate(0.3)",
              }}
              draggable={false}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <AnimatedHedgehog
                animation="fire"
                fps={14}
                size={FIRE_SIZE}
                loop={true}
              />
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
