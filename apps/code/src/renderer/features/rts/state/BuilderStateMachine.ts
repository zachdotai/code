import type { Nest } from "@main/services/rts/schemas";
import { HEDGEMONY_CONFIG } from "../config";
import {
  findPath,
  type Obstacle,
  snapGoal,
  snapPointOutsideObstacles,
  type Vec2,
} from "../utils/pathfinding";
import { worldObstacles } from "../utils/worldObstacles";

export type BuilderAnimation = "idle" | "walking" | "building";

export type BuilderState =
  | { kind: "idle" }
  | { kind: "walking"; onArrive: "idle" | "build" }
  | { kind: "building" };

export interface BuilderSnapshot {
  state: BuilderState;
  path: Vec2[];
  lastReachedIndex: number;
  pendingNest: Nest | null;
}

export interface BuilderStateMachineOptions {
  initialPos: Vec2;
  buildAnimationMs?: number;
  /** Called when the snapshot changes. The React adapter wires this to
   * setState; non-React callers can subscribe similarly. */
  onChange: (snapshot: BuilderSnapshot) => void;
  /** Called when a pending build is committed — either the build animation
   * finished or an interrupting walk committed it early. Without this the
   * pending nest never becomes visible. */
  onCommitPendingBuild?: (nest: Nest) => void;
}

export interface StartWalkInput {
  target: Vec2;
  from: Vec2;
  onArrive: "idle" | "build";
  nests: Nest[];
  buildingFor?: Nest;
  extraObstacles?: Obstacle[];
}

export interface StartWalkResult {
  resolvedGoal: Vec2;
  /** The starting position the machine used after snapping out of any
   * obstacle. The caller should sync its visual position to this so the next
   * tween doesn't cut through a building. */
  resolvedFrom: Vec2;
}

/**
 * Plain-class builder state machine: idle / walking / building. Framework
 * agnostic — no React, no framer-motion, no DOM. Tests inject deterministic
 * timers; the React hook wraps this and forwards snapshots into useState.
 *
 * State transitions:
 * - idle -> walking via startWalk(..., onArrive: "idle" | "build")
 * - idle -> building directly when startWalk target == from with onArrive "build"
 * - walking -> idle via handleArrive() when onArrive: "idle"
 * - walking -> building via handleArrive() when onArrive: "build"
 * - building -> idle automatically after buildAnimationMs
 * - building -> walking on interrupting startWalk (timer cleared, pending nest
 *   committed if the new walk isn't another build)
 */
export class BuilderStateMachine {
  private state: BuilderState = { kind: "idle" };
  private path: Vec2[];
  private lastReachedIndex = 0;
  private pendingNest: Nest | null = null;
  private buildingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly buildAnimationMs: number;
  private readonly onChange: (snapshot: BuilderSnapshot) => void;
  private readonly onCommitPendingBuild?: (nest: Nest) => void;
  private disposed = false;

  constructor(options: BuilderStateMachineOptions) {
    this.path = [options.initialPos];
    this.buildAnimationMs =
      options.buildAnimationMs ?? HEDGEMONY_CONFIG.animation.buildMs;
    this.onChange = options.onChange;
    this.onCommitPendingBuild = options.onCommitPendingBuild;
  }

  getSnapshot(): BuilderSnapshot {
    return {
      state: this.state,
      path: this.path,
      lastReachedIndex: this.lastReachedIndex,
      pendingNest: this.pendingNest,
    };
  }

  startWalk(input: StartWalkInput): StartWalkResult {
    const {
      target,
      from,
      onArrive,
      nests,
      buildingFor,
      extraObstacles = [],
    } = input;

    if (this.buildingTimer) {
      clearTimeout(this.buildingTimer);
      this.buildingTimer = null;
    }
    // Any non-build walk interrupts an in-flight build. Commit the pending
    // nest now so it doesn't get stuck invisible forever.
    if (onArrive !== "build") this.commitPendingBuild();
    if (buildingFor) {
      if (this.pendingNest && this.pendingNest !== buildingFor) {
        this.commitPendingBuild();
      }
      this.pendingNest = buildingFor;
    }
    const pendingObstacle = buildingFor ?? this.pendingNest;
    const obstacles = [
      ...worldObstacles(nests, { pendingNest: pendingObstacle }),
      ...extraObstacles,
    ];
    // Self-heal a stranded `from`. The caller may be passing a stale visual
    // position from before an obstacle moved (HMR, nest built on top of the
    // builder, etc.). If we hand a blocked point straight to findPath, the
    // planner correctly escapes — but it prepends the original blocked point
    // as path[0], which the sprite will snap to on the next render,
    // *committing* the visual to inside the obstacle. Snap to the perimeter
    // first so path[0] is always safe.
    const resolvedFrom = snapPointOutsideObstacles(from, obstacles);
    const dxFromTarget = target.x - resolvedFrom.x;
    const dyFromTarget = target.y - resolvedFrom.y;
    if (dxFromTarget * dxFromTarget + dyFromTarget * dyFromTarget < 0.01) {
      this.path = [resolvedFrom];
      this.lastReachedIndex = 0;
      if (onArrive === "build") this.enterBuilding();
      else this.setState({ kind: "idle" });
      this.emit();
      return { resolvedGoal: resolvedFrom, resolvedFrom };
    }
    const snapped = snapGoal(resolvedFrom, target, obstacles);
    const plan = findPath(resolvedFrom, snapped, obstacles);
    const resolvedGoal = plan[plan.length - 1] ?? snapped;
    if (plan.length < 2) {
      this.path = plan.length === 1 ? plan : [resolvedFrom];
      this.lastReachedIndex = 0;
      if (onArrive === "build") this.enterBuilding();
      else this.setState({ kind: "idle" });
      this.emit();
      return { resolvedGoal, resolvedFrom };
    }
    this.path = plan;
    this.lastReachedIndex = 0;
    this.setState({ kind: "walking", onArrive });
    this.emit();
    return { resolvedGoal, resolvedFrom };
  }

  handleArrive(): void {
    if (this.state.kind !== "walking") return;
    if (this.state.onArrive === "build") {
      this.enterBuilding();
    } else {
      this.setState({ kind: "idle" });
    }
    this.emit();
  }

  handleSegmentComplete(index: number): void {
    this.lastReachedIndex = index;
    this.emit();
  }

  /**
   * Push `from` out of any obstacles in the current `nests` snapshot. If the
   * point was stranded inside an obstacle, updates internal path/state so the
   * sprite snaps to the safe perimeter; returns the resolved safe point.
   * Returns null if nothing changed.
   */
  healAt(from: Vec2, nests: Nest[]): Vec2 | null {
    const obstacles = worldObstacles(nests, { pendingNest: this.pendingNest });
    const safe = snapPointOutsideObstacles(from, obstacles);
    if (safe.x === from.x && safe.y === from.y) return null;
    this.path = [safe];
    this.lastReachedIndex = 0;
    this.emit();
    return safe;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.buildingTimer) {
      clearTimeout(this.buildingTimer);
      this.buildingTimer = null;
    }
  }

  private setState(next: BuilderState): void {
    this.state = next;
  }

  private enterBuilding(): void {
    if (this.buildingTimer) clearTimeout(this.buildingTimer);
    this.setState({ kind: "building" });
    this.buildingTimer = setTimeout(() => {
      this.buildingTimer = null;
      this.setState({ kind: "idle" });
      this.commitPendingBuild();
      this.emit();
    }, this.buildAnimationMs);
  }

  private commitPendingBuild(): void {
    const pending = this.pendingNest;
    if (!pending) return;
    this.pendingNest = null;
    this.onCommitPendingBuild?.(pending);
  }

  private emit(): void {
    if (this.disposed) return;
    this.onChange(this.getSnapshot());
  }
}
