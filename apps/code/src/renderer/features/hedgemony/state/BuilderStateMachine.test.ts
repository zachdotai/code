import type { Nest } from "@main/services/hedgemony/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BuilderSnapshot,
  BuilderStateMachine,
} from "./BuilderStateMachine";

function makeNest(overrides: Partial<Nest> = {}): Nest {
  return {
    id: "nest-1",
    name: "Test nest",
    goalPrompt: "Do a thing",
    definitionOfDone: null,
    mapX: 0,
    mapY: 0,
    status: "active",
    health: "ok",
    targetMetricId: null,
    loadoutJson: null,
    primaryRepository: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

interface Harness {
  machine: BuilderStateMachine;
  latest: BuilderSnapshot;
  changes: BuilderSnapshot[];
  commits: Nest[];
}

function makeMachine(
  options: {
    initialPos?: { x: number; y: number };
    buildAnimationMs?: number;
  } = {},
): Harness {
  const harness: Harness = {
    machine: null as unknown as BuilderStateMachine,
    latest: {
      state: { kind: "idle" },
      path: [options.initialPos ?? { x: 0, y: 160 }],
      lastReachedIndex: 0,
      pendingNest: null,
    },
    changes: [],
    commits: [],
  };
  harness.machine = new BuilderStateMachine({
    initialPos: options.initialPos ?? { x: 0, y: 160 },
    buildAnimationMs: options.buildAnimationMs,
    onChange: (snapshot) => {
      harness.latest = snapshot;
      harness.changes.push(snapshot);
    },
    onCommitPendingBuild: (nest) => harness.commits.push(nest),
  });
  return harness;
}

describe("BuilderStateMachine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("starts in idle at the initial snapshot", () => {
    const { machine } = makeMachine({ initialPos: { x: 300, y: 300 } });
    expect(machine.getSnapshot()).toEqual({
      state: { kind: "idle" },
      path: [{ x: 300, y: 300 }],
      lastReachedIndex: 0,
      pendingNest: null,
    });
  });

  it("startWalk to a reachable target transitions to walking with a computed path", () => {
    const harness = makeMachine();
    harness.machine.startWalk({
      target: { x: 500, y: 0 },
      from: { x: 0, y: 300 },
      onArrive: "idle",
      nests: [],
    });
    expect(harness.latest.state).toEqual({ kind: "walking", onArrive: "idle" });
    expect(harness.latest.path.length).toBeGreaterThanOrEqual(2);
  });

  it("handleArrive from walking with onArrive idle returns to idle", () => {
    const { machine } = makeMachine();
    machine.startWalk({
      target: { x: 200, y: 0 },
      from: { x: 0, y: 300 },
      onArrive: "idle",
      nests: [],
    });
    machine.handleArrive();
    expect(machine.getSnapshot().state).toEqual({ kind: "idle" });
  });

  it("handleArrive from walking with onArrive build transitions to building", () => {
    const { machine } = makeMachine({ buildAnimationMs: 1500 });
    machine.startWalk({
      target: { x: 200, y: 0 },
      from: { x: 0, y: 300 },
      onArrive: "build",
      nests: [],
    });
    machine.handleArrive();
    expect(machine.getSnapshot().state).toEqual({ kind: "building" });
  });

  it("building auto-transitions to idle after buildAnimationMs and commits the pending nest", () => {
    const nest = makeNest({ id: "pending", mapX: 200, mapY: 0 });
    const harness = makeMachine({ buildAnimationMs: 1500 });
    harness.machine.startWalk({
      target: { x: 200, y: 0 },
      from: { x: 0, y: 300 },
      onArrive: "build",
      nests: [],
      buildingFor: nest,
    });
    harness.machine.handleArrive();
    expect(harness.machine.getSnapshot().state).toEqual({ kind: "building" });
    expect(harness.commits).toEqual([]);
    vi.advanceTimersByTime(1500);
    expect(harness.machine.getSnapshot().state).toEqual({ kind: "idle" });
    expect(harness.commits).toEqual([nest]);
  });

  it("a new startWalk during building cancels the build timer", () => {
    const harness = makeMachine({ buildAnimationMs: 1500 });
    harness.machine.startWalk({
      target: { x: 100, y: 0 },
      from: { x: 0, y: 300 },
      onArrive: "build",
      nests: [],
    });
    harness.machine.handleArrive();
    expect(harness.machine.getSnapshot().state).toEqual({ kind: "building" });
    harness.machine.startWalk({
      target: { x: 300, y: 0 },
      from: { x: 100, y: 0 },
      onArrive: "idle",
      nests: [],
    });
    expect(harness.machine.getSnapshot().state).toEqual({
      kind: "walking",
      onArrive: "idle",
    });
    // Advancing past the original build timer should NOT trip us back to idle
    // out of nowhere — we're now walking and stay walking.
    vi.advanceTimersByTime(1500);
    expect(harness.machine.getSnapshot().state).toEqual({
      kind: "walking",
      onArrive: "idle",
    });
  });

  it("startWalk with a zero-distance target into build immediately enters building", () => {
    const { machine } = makeMachine({ initialPos: { x: 300, y: 300 } });
    machine.startWalk({
      target: { x: 300, y: 300 },
      from: { x: 300, y: 300 },
      onArrive: "build",
      nests: [],
    });
    expect(machine.getSnapshot().state).toEqual({ kind: "building" });
  });

  it("startWalk with a zero-distance target into idle stays idle", () => {
    const { machine } = makeMachine({ initialPos: { x: 300, y: 300 } });
    machine.startWalk({
      target: { x: 300, y: 300 },
      from: { x: 300, y: 300 },
      onArrive: "idle",
      nests: [],
    });
    expect(machine.getSnapshot().state).toEqual({ kind: "idle" });
  });

  it("handleSegmentComplete advances the snapshot's lastReachedIndex", () => {
    const harness = makeMachine({ initialPos: { x: -500, y: 300 } });
    harness.machine.startWalk({
      target: { x: 400, y: 300 },
      from: { x: -500, y: 300 },
      onArrive: "idle",
      nests: [],
    });
    expect(harness.latest.path.length).toBeGreaterThanOrEqual(2);
    harness.machine.handleSegmentComplete(1);
    expect(harness.machine.getSnapshot().lastReachedIndex).toBe(1);
  });

  it("paths around a nest obstacle on the straight line", () => {
    const nest = makeNest({ id: "n1", mapX: 200, mapY: 300 });
    const { machine } = makeMachine({ initialPos: { x: 0, y: 300 } });
    machine.startWalk({
      target: { x: 400, y: 300 },
      from: { x: 0, y: 300 },
      onArrive: "idle",
      nests: [nest],
    });
    expect(machine.getSnapshot().path.length).toBeGreaterThanOrEqual(3);
  });

  it("paths around extra unit obstacles supplied by the caller", () => {
    const { machine } = makeMachine({ initialPos: { x: 0, y: 300 } });
    machine.startWalk({
      target: { x: 400, y: 300 },
      from: { x: 0, y: 300 },
      onArrive: "idle",
      nests: [],
      extraObstacles: [{ x: 200, y: 300, radius: 24 }],
    });
    expect(machine.getSnapshot().path.length).toBeGreaterThanOrEqual(3);
  });

  it("snaps a stranded `from` to the obstacle perimeter before planning", () => {
    // Caller passes a `from` that's inside the Hedgehouse (radius 100,
    // inflated 136). The machine must heal it before planning, so path[0]
    // ends up outside the obstacle.
    const { machine } = makeMachine();
    const result = machine.startWalk({
      target: { x: 400, y: -400 },
      from: { x: 50, y: -50 },
      onArrive: "idle",
      nests: [],
    });
    // resolvedFrom is the snapped point, must be outside the painted
    // Hedgehouse footprint.
    expect(
      Math.hypot(result.resolvedFrom.x, result.resolvedFrom.y),
    ).toBeGreaterThanOrEqual(99);
    // Every waypoint stays outside the painted Hedgehouse.
    for (const p of machine.getSnapshot().path) {
      expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(99);
    }
  });

  it("healAt pushes a stranded position to the perimeter and updates the snapshot", () => {
    const { machine } = makeMachine({ initialPos: { x: 300, y: 300 } });
    const swallower = makeNest({ id: "swallower", mapX: 300, mapY: 300 });
    const safe = machine.healAt({ x: 300, y: 300 }, [swallower]);
    expect(safe).not.toBeNull();
    if (!safe) return;
    // Nest painted radius is 86 (config); resolved point must be outside it.
    expect(
      Math.hypot(safe.x - swallower.mapX, safe.y - swallower.mapY),
    ).toBeGreaterThanOrEqual(77);
    expect(machine.getSnapshot().path).toEqual([safe]);
    expect(machine.getSnapshot().lastReachedIndex).toBe(0);
  });

  it("healAt is a no-op when the position is already safe", () => {
    const { machine, changes } = makeMachine({
      initialPos: { x: 400, y: 400 },
    });
    const safe = machine.healAt({ x: 400, y: 400 }, []);
    expect(safe).toBeNull();
    // No emit when nothing changed.
    expect(changes.length).toBe(0);
  });

  it("interrupting a pending build with a non-build walk commits the pending nest", () => {
    const nest = makeNest({ id: "pending", mapX: 200, mapY: 0 });
    const harness = makeMachine();
    harness.machine.startWalk({
      target: { x: 200, y: 0 },
      from: { x: 0, y: 300 },
      onArrive: "build",
      nests: [],
      buildingFor: nest,
    });
    harness.machine.startWalk({
      target: { x: 50, y: 0 },
      from: { x: 0, y: 300 },
      onArrive: "idle",
      nests: [],
    });
    expect(harness.commits).toEqual([nest]);
  });

  it("queueing a second pending build commits the first one immediately", () => {
    const first = makeNest({ id: "first", mapX: 100, mapY: 0 });
    const second = makeNest({ id: "second", mapX: 300, mapY: 0 });
    const harness = makeMachine();
    harness.machine.startWalk({
      target: { x: 100, y: 0 },
      from: { x: 0, y: 300 },
      onArrive: "build",
      nests: [],
      buildingFor: first,
    });
    harness.machine.startWalk({
      target: { x: 300, y: 0 },
      from: { x: 0, y: 300 },
      onArrive: "build",
      nests: [],
      buildingFor: second,
    });
    expect(harness.commits).toEqual([first]);
  });

  it("does not double-commit when handleArrive then the build timer both fire", () => {
    const nest = makeNest({ id: "pending", mapX: 200, mapY: 0 });
    const harness = makeMachine({ buildAnimationMs: 1500 });
    harness.machine.startWalk({
      target: { x: 200, y: 0 },
      from: { x: 0, y: 300 },
      onArrive: "build",
      nests: [],
      buildingFor: nest,
    });
    harness.machine.handleArrive();
    vi.advanceTimersByTime(1500);
    expect(harness.commits).toEqual([nest]);
  });

  it("does not commit when no pending build is queued", () => {
    const harness = makeMachine({ buildAnimationMs: 1500 });
    harness.machine.startWalk({
      target: { x: 200, y: 0 },
      from: { x: 0, y: 300 },
      onArrive: "build",
      nests: [],
    });
    harness.machine.handleArrive();
    vi.advanceTimersByTime(1500);
    expect(harness.commits).toEqual([]);
  });

  it("handleArrive is a no-op when not walking", () => {
    const { machine, changes } = makeMachine();
    machine.handleArrive();
    expect(machine.getSnapshot().state).toEqual({ kind: "idle" });
    expect(changes.length).toBe(0);
  });

  it("dispose clears a pending build timer", () => {
    const harness = makeMachine({ buildAnimationMs: 1500 });
    harness.machine.startWalk({
      target: { x: 200, y: 0 },
      from: { x: 0, y: 300 },
      onArrive: "build",
      nests: [],
    });
    harness.machine.handleArrive();
    expect(harness.machine.getSnapshot().state).toEqual({ kind: "building" });
    harness.machine.dispose();
    // After dispose the timer must not fire any further state changes.
    const changesBeforeAdvance = harness.changes.length;
    vi.advanceTimersByTime(1500);
    expect(harness.changes.length).toBe(changesBeforeAdvance);
  });

  it("dispose is idempotent", () => {
    const { machine } = makeMachine();
    machine.dispose();
    expect(() => machine.dispose()).not.toThrow();
  });

  it("emits no snapshot updates after dispose", () => {
    const harness = makeMachine();
    harness.machine.dispose();
    const before = harness.changes.length;
    harness.machine.handleSegmentComplete(0);
    expect(harness.changes.length).toBe(before);
  });
});
