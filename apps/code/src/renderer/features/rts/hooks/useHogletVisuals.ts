import type { Hoglet } from "@main/services/rts/schemas";
import { useTRPC } from "@renderer/trpc";
import { useQuery } from "@tanstack/react-query";
import type { MotionValue } from "framer-motion";
import { useCallback } from "react";
import type { PrState, TaskStatus } from "../components/hogletStatus";
import { FPS_BY_TASK_STATUS } from "../components/hogletStatus";
import { HEDGEMONY_CONFIG } from "../config";
import {
  selectHogletWalkPath,
  useHogletPositionStore,
} from "../stores/hogletPositionStore";
import { selectTaskSummary, useHogletStore } from "../stores/hogletStore";
import { selectNests, useNestStore } from "../stores/nestStore";
import { useCollisionResolvedPosition } from "../utils/collisionResolution";
import { selectHogletAnimation } from "../utils/selectHogletAnimation";
import { HOGLET_RADIUS, worldObstacles } from "../utils/worldObstacles";
import { useTransitPath } from "./useTransitPath";
import { useWalkTo } from "./useWalkTo";

export interface UseHogletVisualsResult {
  motionX: MotionValue<number>;
  motionY: MotionValue<number>;
  facing: "left" | "right";
  isWalking: boolean;
  status: TaskStatus;
  animationKey: ReturnType<typeof selectHogletAnimation>;
  fps: number;
  prState: PrState | null;
  title: string;
  cancelled: boolean;
}

/**
 * Shared visual state for hoglet sprites — walk animation, status-derived
 * animation key, PR state, collision-resolved motion values. Used by both
 * WildHoglet (on-map flock) and BroodHoglet (in-nest cluster) so the two
 * components stay structurally identical and divergence becomes a bug
 * rather than a refactor.
 */
export function useHogletVisuals(
  hoglet: Hoglet,
  x: number,
  y: number,
): UseHogletVisualsResult {
  const summary = useHogletStore(selectTaskSummary(hoglet.taskId));
  const trpc = useTRPC();

  const walkPath = useHogletPositionStore(selectHogletWalkPath(hoglet.id));
  const computedPath = useTransitPath(
    x,
    y,
    HOGLET_RADIUS,
    walkPath === undefined,
    hoglet.id,
  );
  const { motionX, motionY, isWalking, facing } = useWalkTo(
    x,
    y,
    walkPath ?? computedPath,
  );
  const nests = useNestStore(selectNests);
  const getStaticObstacles = useCallback(() => worldObstacles(nests), [nests]);
  const { resolvedX, resolvedY } = useCollisionResolvedPosition(
    hoglet.id,
    motionX,
    motionY,
    HOGLET_RADIUS,
    getStaticObstacles,
    { visualRegistryId: hoglet.id },
  );

  const prStatusQuery = useQuery(
    trpc.workspace.getTaskPrStatus.queryOptions(
      { taskId: hoglet.taskId, cloudPrUrl: null },
      { staleTime: HEDGEMONY_CONFIG.polling.prStatusStaleMs },
    ),
  );

  const status: TaskStatus = (summary?.latest_run?.status ??
    "not_started") as TaskStatus;
  const title = summary?.title ?? hoglet.taskId.slice(0, 8);
  const prState = prStatusQuery.data?.prState ?? null;
  const animationKey = selectHogletAnimation(
    status,
    isWalking,
    hoglet.signalReportId !== null,
  );
  const fps = isWalking
    ? HEDGEMONY_CONFIG.animation.fps.walk
    : FPS_BY_TASK_STATUS[status ?? "not_started"];
  const cancelled = status === "cancelled";

  return {
    motionX: resolvedX,
    motionY: resolvedY,
    facing,
    isWalking,
    status,
    animationKey,
    fps,
    prState,
    title,
    cancelled,
  };
}
