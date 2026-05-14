import {
  type AnimationPlaybackControls,
  animate,
  type MotionValue,
  useMotionValue,
} from "framer-motion";
import { useEffect, useRef, useState } from "react";

const SPEED = 120;

interface WalkToResult {
  motionX: MotionValue<number>;
  motionY: MotionValue<number>;
  isWalking: boolean;
  facing: "left" | "right";
}

export function useWalkTo(targetX: number, targetY: number): WalkToResult {
  const motionX = useMotionValue(targetX);
  const motionY = useMotionValue(targetY);
  const [isWalking, setIsWalking] = useState(false);
  const [facing, setFacing] = useState<"left" | "right">("right");
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      motionX.set(targetX);
      motionY.set(targetY);
      return;
    }

    const dx = targetX - motionX.get();
    const dy = targetY - motionY.get();
    const dist = Math.hypot(dx, dy);

    if (dist < 1) return;

    if (dx > 0) setFacing("right");
    else if (dx < 0) setFacing("left");

    const duration = dist / SPEED;
    setIsWalking(true);

    let xCtrl: AnimationPlaybackControls | null = null;
    let yCtrl: AnimationPlaybackControls | null = null;

    xCtrl = animate(motionX, targetX, { duration, ease: "linear" });
    yCtrl = animate(motionY, targetY, {
      duration,
      ease: "linear",
      onComplete: () => setIsWalking(false),
    });

    return () => {
      xCtrl?.stop();
      yCtrl?.stop();
      setIsWalking(false);
    };
  }, [targetX, targetY, motionX, motionY]);

  return { motionX, motionY, isWalking, facing };
}
