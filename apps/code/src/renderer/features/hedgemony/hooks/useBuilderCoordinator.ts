import type { Nest } from "@main/services/hedgemony/schemas";
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  findPath,
  type Obstacle,
  snapGoal,
  type Vec2,
} from "../utils/pathfinding";

const DEFAULT_BUILD_ANIMATION_MS = 1500;
const DEFAULT_NEST_OBSTACLE_RADIUS = 56;
const DEFAULT_INITIAL_POS: Vec2 = { x: 0, y: 0 };

export type BuilderAnimation = "idle" | "walking" | "building";

type BuilderState =
  | { kind: "idle" }
  | { kind: "walking"; onArrive: "idle" | "build" }
  | { kind: "building" };

export interface UseBuilderCoordinatorOptions {
  nests: Nest[];
  buildAnimationMs?: number;
  nestObstacleRadius?: number;
  initialPos?: Vec2;
  /** Called when a pending build is committed — either because the build
   * animation finished, or because something interrupted it. The caller is
   * expected to make the nest visible (e.g. by upserting it into a store).
   * Without this callback the deferred-sprite feature is inert. */
  onPendingBuildCommit?: (nest: Nest) => void;
}

export interface BuilderCoordinator {
  /** Waypoint list the sprite walks through. */
  path: Vec2[];
  /** Nominal position (last reached waypoint). Use visualPosRef for actual
   * on-screen position. */
  pos: Vec2;
  animation: BuilderAnimation;
  /** Written each motion frame by BuilderSprite. Read as the start of any
   * re-plan so the new path begins where the sprite visually is. */
  visualPosRef: MutableRefObject<Vec2>;
  /** Plan a path to target and start the walk. Returns the resolved goal
   * (the goal may be snapped to an obstacle edge if the click was on a
   * nest). Pass `buildingFor` to defer the nest sprite until the build
   * animation completes: the location is treated as an obstacle for
   * pathfinding but isn't committed until then. */
  startWalk: (
    target: Vec2,
    onArrive: "idle" | "build",
    buildingFor?: Nest,
  ) => Vec2;
  /** Called by BuilderSprite when it reaches the final waypoint. */
  handleArrive: () => void;
  /** Called by BuilderSprite each time a waypoint is reached. */
  handleSegmentComplete: (index: number) => void;
}

/**
 * Owns the builder hedgehog's path, state machine (idle / walking / building),
 * and the build-completion timer. Extracted from HedgemonyMapView so the
 * state transitions are testable in isolation and so the view doesn't grow a
 * second copy for hedgerows / wild hoglets later.
 */
export function useBuilderCoordinator({
  nests,
  buildAnimationMs = DEFAULT_BUILD_ANIMATION_MS,
  nestObstacleRadius = DEFAULT_NEST_OBSTACLE_RADIUS,
  initialPos = DEFAULT_INITIAL_POS,
  onPendingBuildCommit,
}: UseBuilderCoordinatorOptions): BuilderCoordinator {
  const [path, setPath] = useState<Vec2[]>([initialPos]);
  const [lastReachedIndex, setLastReachedIndex] = useState(0);
  const [state, setState] = useState<BuilderState>({ kind: "idle" });
  const buildingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visualPosRef = useRef<Vec2>({ ...initialPos });
  const pendingBuildRef = useRef<Nest | null>(null);
  const onPendingBuildCommitRef = useRef(onPendingBuildCommit);
  onPendingBuildCommitRef.current = onPendingBuildCommit;

  useEffect(() => {
    return () => {
      if (buildingTimerRef.current) clearTimeout(buildingTimerRef.current);
    };
  }, []);

  const commitPendingBuild = useCallback(() => {
    const pending = pendingBuildRef.current;
    if (!pending) return;
    pendingBuildRef.current = null;
    onPendingBuildCommitRef.current?.(pending);
  }, []);

  const enterBuilding = useCallback(() => {
    if (buildingTimerRef.current) clearTimeout(buildingTimerRef.current);
    setState({ kind: "building" });
    buildingTimerRef.current = setTimeout(() => {
      setState({ kind: "idle" });
      buildingTimerRef.current = null;
      commitPendingBuild();
    }, buildAnimationMs);
  }, [buildAnimationMs, commitPendingBuild]);

  const startWalk = useCallback(
    (target: Vec2, onArrive: "idle" | "build", buildingFor?: Nest): Vec2 => {
      if (buildingTimerRef.current) {
        clearTimeout(buildingTimerRef.current);
        buildingTimerRef.current = null;
      }
      // Any non-build walk interrupts an in-flight build. Commit the pending
      // nest now so it doesn't get stuck invisible forever.
      if (onArrive !== "build") commitPendingBuild();
      // Queue the new pending build (committing any prior one first).
      if (buildingFor) {
        if (pendingBuildRef.current && pendingBuildRef.current !== buildingFor) {
          commitPendingBuild();
        }
        pendingBuildRef.current = buildingFor;
      }
      const from = visualPosRef.current;
      const dxFromTarget = target.x - from.x;
      const dyFromTarget = target.y - from.y;
      if (dxFromTarget * dxFromTarget + dyFromTarget * dyFromTarget < 0.01) {
        // Already at the target — skip planning + walking, transition straight
        // to the post-arrival state.
        setPath([from]);
        setLastReachedIndex(0);
        if (onArrive === "build") enterBuilding();
        else setState({ kind: "idle" });
        return from;
      }
      const obstacles: Obstacle[] = nests.map((nest) => ({
        x: nest.mapX,
        y: nest.mapY,
        radius: nestObstacleRadius,
      }));
      // The nest we're walking to build isn't in the store yet, but we still
      // want collision to treat the spot as occupied so the builder snaps to
      // the perimeter instead of standing on top of the eventual sprite.
      const pendingObstacle = buildingFor ?? pendingBuildRef.current;
      if (pendingObstacle) {
        obstacles.push({
          x: pendingObstacle.mapX,
          y: pendingObstacle.mapY,
          radius: nestObstacleRadius,
        });
      }
      const snapped = snapGoal(from, target, obstacles);
      const plan = findPath(from, snapped, obstacles);
      const resolvedGoal = plan[plan.length - 1] ?? snapped;
      if (plan.length < 2) {
        setPath(plan.length === 1 ? plan : [from]);
        setLastReachedIndex(0);
        if (onArrive === "build") enterBuilding();
        else setState({ kind: "idle" });
        return resolvedGoal;
      }
      setPath(plan);
      setLastReachedIndex(0);
      setState({ kind: "walking", onArrive });
      return resolvedGoal;
    },
    [nests, nestObstacleRadius, enterBuilding, commitPendingBuild],
  );

  const handleArrive = useCallback(() => {
    setState((current) => {
      if (current.kind !== "walking") return current;
      if (current.onArrive === "build") {
        enterBuilding();
        return { kind: "building" };
      }
      return { kind: "idle" };
    });
  }, [enterBuilding]);

  const handleSegmentComplete = useCallback((index: number) => {
    setLastReachedIndex(index);
  }, []);

  const animation: BuilderAnimation =
    state.kind === "walking"
      ? "walking"
      : state.kind === "building"
        ? "building"
        : "idle";

  const pos: Vec2 = path[lastReachedIndex] ?? initialPos;

  return {
    path,
    pos,
    animation,
    visualPosRef,
    startWalk,
    handleArrive,
    handleSegmentComplete,
  };
}
