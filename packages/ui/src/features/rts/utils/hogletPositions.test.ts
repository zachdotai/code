import type { Hoglet, Nest } from "@posthog/host-router/rts-schemas";
import { describe, expect, it } from "vitest";
import { WILD_BUCKET } from "../constants/buckets";
import {
  avoidHogletObstacleCollision,
  broodHogletPosition,
  collectHogletWorldPositions,
} from "./hogletPositions";
import {
  HOGLET_RADIUS,
  NEST_OBSTACLE_RADIUS,
  worldObstacles,
} from "./worldObstacles";

function makeNest(overrides: Partial<Nest> = {}): Nest {
  return {
    id: overrides.id ?? "nest-1",
    name: overrides.name ?? "Test nest",
    goalPrompt: overrides.goalPrompt ?? "Do a thing",
    definitionOfDone: overrides.definitionOfDone ?? null,
    mapX: overrides.mapX ?? 0,
    mapY: overrides.mapY ?? 0,
    status: overrides.status ?? "active",
    health: overrides.health ?? "ok",
    targetMetricId: overrides.targetMetricId ?? null,
    loadoutJson: overrides.loadoutJson ?? null,
    primaryRepository: overrides.primaryRepository ?? null,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
  };
}

function makeHoglet(overrides: Partial<Hoglet> = {}): Hoglet {
  return {
    id: overrides.id ?? "hoglet-1",
    taskId: overrides.taskId ?? "task-1",
    nestId: overrides.nestId ?? null,
    signalReportId: overrides.signalReportId ?? null,
    name: overrides.name ?? "James",
    affinityScore: overrides.affinityScore ?? null,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("hogletPositions", () => {
  it("places brood hoglets outside the nest collision radius", () => {
    const nest = makeNest({ mapX: 100, mapY: 50 });
    const inflated = NEST_OBSTACLE_RADIUS + HOGLET_RADIUS;

    for (let total = 1; total <= 10; total++) {
      for (let index = 0; index < total; index++) {
        const pos = broodHogletPosition(index, total, {
          x: nest.mapX,
          y: nest.mapY,
        });
        expect(distance(pos, { x: nest.mapX, y: nest.mapY })).toBeGreaterThan(
          inflated,
        );
      }
    }
  });

  it("nudges resting hoglet positions out of world obstacles", () => {
    const nest = makeNest();

    const pos = avoidHogletObstacleCollision({ x: 10, y: 0 }, [nest]);

    for (const obstacle of worldObstacles([nest])) {
      expect(distance(pos, obstacle)).toBeGreaterThanOrEqual(
        obstacle.radius + HOGLET_RADIUS,
      );
    }
  });

  it("collects collision-safe positions for persisted overrides", () => {
    const nest = makeNest({ id: "nest-1" });
    const hoglet = makeHoglet({ id: "hoglet-1", nestId: nest.id });

    const [pos] = collectHogletWorldPositions(
      [nest],
      {
        [WILD_BUCKET]: [],
        [nest.id]: [hoglet],
      },
      { [hoglet.id]: { x: 0, y: 0 } },
    );

    expect(pos).toBeDefined();
    if (!pos) throw new Error("expected position");
    expect(
      distance(pos, { x: nest.mapX, y: nest.mapY }),
    ).toBeGreaterThanOrEqual(NEST_OBSTACLE_RADIUS + HOGLET_RADIUS);
  });

  it("separates hoglets that would otherwise share a resting point", () => {
    const nest = makeNest({ id: "nest-1" });
    const first = makeHoglet({ id: "hoglet-1", nestId: nest.id });
    const second = makeHoglet({ id: "hoglet-2", nestId: nest.id });

    const positions = collectHogletWorldPositions(
      [nest],
      {
        [WILD_BUCKET]: [],
        [nest.id]: [first, second],
      },
      {
        [first.id]: { x: 0, y: 0 },
        [second.id]: { x: 0, y: 0 },
      },
    );

    expect(positions).toHaveLength(2);
    expect(distance(positions[0], positions[1])).toBeGreaterThanOrEqual(
      HOGLET_RADIUS * 2 - 0.1,
    );
    for (const pos of positions) {
      expect(
        distance(pos, { x: nest.mapX, y: nest.mapY }),
      ).toBeGreaterThanOrEqual(NEST_OBSTACLE_RADIUS + HOGLET_RADIUS - 0.1);
    }
  });
});
