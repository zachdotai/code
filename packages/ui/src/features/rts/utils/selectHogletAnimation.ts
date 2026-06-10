import type { HedgehogAnimation } from "../components/AnimatedHedgehog";
import {
  ANIMATION_BY_TASK_STATUS,
  ANIMATION_BY_TASK_STATUS_ROBO,
  type TaskStatus,
} from "../components/hogletStatus";

/**
 * Pick the sprite animation for a hoglet given its task status, walking state,
 * and whether it's a signal-backed (robo) variant. Pure function — used by
 * both WildHoglet and BroodHoglet so the animation logic stays in lockstep.
 */
export function selectHogletAnimation(
  status: TaskStatus | null | undefined,
  isWalking: boolean,
  isRoboSignal: boolean,
): HedgehogAnimation {
  if (isWalking) {
    return isRoboSignal ? "walkRobo" : "walk";
  }
  const effectiveStatus = status ?? "not_started";
  const table = isRoboSignal
    ? ANIMATION_BY_TASK_STATUS_ROBO
    : ANIMATION_BY_TASK_STATUS;
  return table[effectiveStatus];
}
