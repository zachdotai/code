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
  snapPointOutsideObstacles,
  type Vec2,
} from "../utils/pathfinding";
import { worldObstacles } from "../utils/worldObstacles";

const DEFAULT_BUILD_ANIMATION_MS = 1500;
// Park the builder just south of the Hedgehouse. The previous attempt at
// (0, 130) was still broken: pathfinding inflates the Hedgehouse obstacle
// (raw radius 100) by the agent's pathfinding radius (36 for the builder)
// before testing intersections, giving an effective avoid-radius of 136.
// Any spawn at distance < 136 from origin is treated as "inside the
// obstacle" and triggers findPath's escape logic — which walks straight
// toward the goal until it clears the inflation. From (0, 130) heading
// north of the Hedgehouse, that escape cuts straight through the building.
// y=160 keeps the spawn comfortably outside the 136 inflation with a 24px
// buffer so any future radius tweak still leaves headroom.
const DEFAULT_INITIAL_POS: Vec2 = { x: 0, y: 160 };

export type BuilderAnimation = "idle" | "walking" | "building";

type BuilderState =
  | { kind: "idle" }
  | { kind: "walking"; onArrive: "idle" | "build" }
  | { kind: "building" };

export interface UseBuilderCoordinatorOptions {
  nests: Nest[];
  buildAnimationMs?: number;
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
  /** The nest queued by `startWalk(..., "build", nest)` — not yet committed
   * to the nest store, but the location is known. Surfaces use it to render
   * a construction-in-progress visual at the destination so the nest doesn't
   * pop into existence with no warning. */
  pendingNest: Nest | null;
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
    extraObstacles?: Obstacle[],
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
  initialPos = DEFAULT_INITIAL_POS,
  onPendingBuildCommit,
}: UseBuilderCoordinatorOptions): BuilderCoordinator {
  const [path, setPath] = useState<Vec2[]>([initialPos]);
  const [lastReachedIndex, setLastReachedIndex] = useState(0);
  const [state, setState] = useState<BuilderState>({ kind: "idle" });
  const buildingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visualPosRef = useRef<Vec2>({ ...initialPos });
  // Ref + state mirror: internal logic needs synchronous reads inside the same
  // `startWalk` call, while consumers need re-renders when the pending nest
  // changes (to show/hide the construction site).
  const pendingBuildRef = useRef<Nest | null>(null);
  const [pendingNest, setPendingNest] = useState<Nest | null>(null);
  const setPending = useCallback((next: Nest | null) => {
    pendingBuildRef.current = next;
    setPendingNest(next);
  }, []);
  const onPendingBuildCommitRef = useRef(onPendingBuildCommit);
  onPendingBuildCommitRef.current = onPendingBuildCommit;

  useEffect(() => {
    return () => {
      if (buildingTimerRef.current) clearTimeout(buildingTimerRef.current);
    };
  }, []);

  // Self-heal a stranded builder. Runs on mount and whenever the obstacle set
  // (the nest list) changes: if visualPosRef has somehow landed inside an
  // obstacle — Vite Fast Refresh preserving a pre-fix motionX/Y, a nest being
  // built right on top of the builder, etc. — push it to the nearest
  // perimeter and emit a single-waypoint path so BuilderSprite snaps motionX/Y
  // there. Without this, the builder can sit visibly inside a building at rest
  // until the user manually clicks somewhere.
  useEffect(() => {
    const obstacles = worldObstacles(nests, {
      pendingNest: pendingBuildRef.current,
    });
    const rawFrom = visualPosRef.current;
    const safe = snapPointOutsideObstacles(rawFrom, obstacles);
    if (safe.x === rawFrom.x && safe.y === rawFrom.y) return;
    visualPosRef.current = safe;
    setPath([safe]);
    setLastReachedIndex(0);
  }, [nests]);

  const commitPendingBuild = useCallback(() => {
    const pending = pendingBuildRef.current;
    if (!pending) return;
    setPending(null);
    onPendingBuildCommitRef.current?.(pending);
  }, [setPending]);

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
    (
      target: Vec2,
      onArrive: "idle" | "build",
      buildingFor?: Nest,
      extraObstacles: Obstacle[] = [],
    ): Vec2 => {
      if (buildingTimerRef.current) {
        clearTimeout(buildingTimerRef.current);
        buildingTimerRef.current = null;
      }
      // Any non-build walk interrupts an in-flight build. Commit the pending
      // nest now so it doesn't get stuck invisible forever.
      if (onArrive !== "build") commitPendingBuild();
      // Queue the new pending build (committing any prior one first).
      if (buildingFor) {
        if (
          pendingBuildRef.current &&
          pendingBuildRef.current !== buildingFor
        ) {
          commitPendingBuild();
        }
        setPending(buildingFor);
      }
      const pendingObstacle = buildingFor ?? pendingBuildRef.current;
      const obstacles = [
        ...worldObstacles(nests, { pendingNest: pendingObstacle }),
        ...extraObstacles,
      ];
      // Self-heal a stranded visual position. Vite Fast Refresh / HMR can
      // leave motionX/motionY (and therefore visualPosRef) stuck at a stale
      // point inside an obstacle from a previous buggy build. If we hand
      // that point straight to findPath, the planner correctly escapes —
      // but it prepends the original blocked `from` as path[0], and the
      // sprite snaps motionX/Y to path[0] on the next render, *committing*
      // the visual to the inside-obstacle position. Push the position to
      // the nearest perimeter first so path[0] is always safe.
      const rawFrom = visualPosRef.current;
      const from = snapPointOutsideObstacles(rawFrom, obstacles);
      if (from.x !== rawFrom.x || from.y !== rawFrom.y) {
        visualPosRef.current = from;
      }
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
    [nests, enterBuilding, commitPendingBuild, setPending],
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
    pendingNest,
    visualPosRef,
    startWalk,
    handleArrive,
    handleSegmentComplete,
  };
}
