import { describe, expect, it } from "vitest";
import {
  findPath,
  type Obstacle,
  snapPointOutsideObstacles,
  type Vec2,
} from "./pathfinding";

const BUILDER_RADIUS = 36;

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function inflatedRadius(o: Obstacle): number {
  return o.radius + BUILDER_RADIUS;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const segLenSq = dx * dx + dy * dy;
  if (segLenSq === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / segLenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

function segmentClearsObstacles(
  a: Vec2,
  b: Vec2,
  obstacles: Obstacle[],
): boolean {
  return obstacles.every(
    (o) => distanceToSegment(o, a, b) >= inflatedRadius(o) - 1e-6,
  );
}

function pointOutsideInflated(p: Vec2, obstacles: Obstacle[]): boolean {
  return obstacles.every((o) => distance(p, o) >= inflatedRadius(o) - 1e-6);
}

describe("findPath", () => {
  it("returns a straight 2-point path when there are no obstacles", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 300, y: 0 };
    const path = findPath(from, to, []);
    expect(path).toEqual([from, to]);
  });

  it("detours around a single obstacle blocking the straight line", () => {
    const from = { x: -300, y: 0 };
    const to = { x: 300, y: 0 };
    const obstacles: Obstacle[] = [{ x: 0, y: 0, radius: 56 }];

    const path = findPath(from, to, obstacles);

    expect(path.length).toBeGreaterThanOrEqual(3);
    expect(path[0]).toEqual(from);
    expect(path[path.length - 1]).toEqual(to);

    for (let i = 0; i < path.length - 1; i++) {
      expect(segmentClearsObstacles(path[i], path[i + 1], obstacles)).toBe(
        true,
      );
    }
    for (let i = 1; i < path.length - 1; i++) {
      expect(pointOutsideInflated(path[i], obstacles)).toBe(true);
    }
  });

  it("snaps a target inside an obstacle to its edge", () => {
    const from = { x: -300, y: 0 };
    const center = { x: 0, y: 0 };
    const obstacle: Obstacle = { x: center.x, y: center.y, radius: 56 };

    const path = findPath(from, center, [obstacle]);

    expect(path.length).toBeGreaterThanOrEqual(2);
    const end = path[path.length - 1];
    const dEnd = distance(end, center);
    expect(dEnd).toBeGreaterThanOrEqual(inflatedRadius(obstacle) - 1e-6);
    expect(dEnd).toBeLessThan(inflatedRadius(obstacle) + 5);
  });

  it("snaps a hoglet target off another hoglet obstacle", () => {
    const hogletRadius = 24;
    const from = { x: -200, y: 0 };
    const occupied = { x: 0, y: 0 };
    const obstacle: Obstacle = {
      x: occupied.x,
      y: occupied.y,
      radius: hogletRadius,
    };

    const path = findPath(from, occupied, [obstacle], hogletRadius);

    const end = path[path.length - 1];
    expect(distance(end, occupied)).toBeGreaterThanOrEqual(
      hogletRadius * 2 - 1e-6,
    );
  });

  it("returns a reachable approach point when target is encircled", () => {
    const from = { x: -400, y: 0 };
    const to = { x: 300, y: 0 };
    const r = 80;
    const ring = 100;
    const obstacles: Obstacle[] = [
      { x: to.x + ring, y: to.y, radius: r },
      { x: to.x - ring, y: to.y, radius: r },
      { x: to.x, y: to.y + ring, radius: r },
      { x: to.x, y: to.y - ring, radius: r },
      { x: to.x + ring * 0.7, y: to.y + ring * 0.7, radius: r },
      { x: to.x - ring * 0.7, y: to.y + ring * 0.7, radius: r },
      { x: to.x + ring * 0.7, y: to.y - ring * 0.7, radius: r },
      { x: to.x - ring * 0.7, y: to.y - ring * 0.7, radius: r },
    ];

    const path = findPath(from, to, obstacles);

    expect(path.length).toBeGreaterThanOrEqual(1);
    const last = path[path.length - 1];
    expect(pointOutsideInflated(last, obstacles)).toBe(true);
  });

  it("escapes when start is inside an obstacle, preserving the original from", () => {
    // Mirrors production: the builder spawns at origin and the Hedgehouse
    // sits there too. Without escape logic, A* can't leave the start cell.
    const from = { x: 0, y: 0 };
    const to = { x: 400, y: 0 };
    const obstacles: Obstacle[] = [{ x: 0, y: 0, radius: 90 }];

    const path = findPath(from, to, obstacles);

    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path[0]).toEqual(from);
    expect(path[path.length - 1]).toEqual(to);
    // Every waypoint after the first must be outside the inflated obstacle —
    // the planner is allowed to start inside, but never to re-enter.
    for (let i = 1; i < path.length; i++) {
      expect(pointOutsideInflated(path[i], obstacles)).toBe(true);
    }
  });

  it("escapes radially outward, not across the obstacle, when start is just inside the inflated boundary", () => {
    // Regression: when the builder's visual position sat at (0, 130) — just
    // inside the Hedgehouse's inflated radius of 100 + 36 = 136 — the old
    // "walk toward the goal" escape ran a step toward the far side until
    // it cleared the inflation, producing a path[1] near (0, -136). The
    // first visible segment cut straight south through the building.
    //
    // The escape must instead push *radially outward* from the obstacle
    // center, so the segment from → escape stays on the near side of the
    // obstacle. Verify by checking that the escape segment never dips into
    // the painted obstacle footprint (radius 100).
    const from = { x: 0, y: 130 };
    const to = { x: 0, y: -400 };
    const obstacles: Obstacle[] = [{ x: 0, y: 0, radius: 100 }];

    const path = findPath(from, to, obstacles);

    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path[0]).toEqual(from);
    // Sample every segment densely — no point of any segment may fall
    // inside the painted obstacle.
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      for (let t = 0; t <= 1; t += 0.02) {
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        expect(Math.hypot(x, y)).toBeGreaterThanOrEqual(99);
      }
    }
  });

  it("backs out locally when a rapid replan starts inside an obstacle buffer", () => {
    const agentRadius = 24;
    const obstacle: Obstacle = { x: 0, y: 0, radius: 24 };
    const from = { x: -30, y: 0 };
    const to = { x: 120, y: 0 };

    const path = findPath(from, to, [obstacle], agentRadius);

    expect(path.length).toBeGreaterThanOrEqual(3);
    expect(path[0]).toEqual(from);
    // The old escape walked toward the target and crossed through the unit at
    // x=0 before routing. A rapid re-click must first back out on the same
    // side it came from, then plan around the blocker.
    expect(path[1].x).toBeLessThan(from.x);
    expect(distance(path[1], obstacle)).toBeGreaterThanOrEqual(
      obstacle.radius + agentRadius - 1e-6,
    );
  });

  it("routes around multiple obstacles that both block the straight line", () => {
    const from = { x: -300, y: 0 };
    const to = { x: 300, y: 0 };
    const obstacles: Obstacle[] = [
      { x: -50, y: 0, radius: 56 },
      { x: 80, y: 0, radius: 56 },
    ];

    const path = findPath(from, to, obstacles);

    expect(path.length).toBeGreaterThanOrEqual(3);
    expect(path[0]).toEqual(from);
    expect(path[path.length - 1]).toEqual(to);

    for (let i = 0; i < path.length - 1; i++) {
      expect(segmentClearsObstacles(path[i], path[i + 1], obstacles)).toBe(
        true,
      );
    }
    for (const p of path) {
      expect(pointOutsideInflated(p, obstacles)).toBe(true);
    }
  });

  it("snaps a resting point outside an inflated obstacle", () => {
    const obstacle: Obstacle = { x: 0, y: 0, radius: 86 };

    const point = snapPointOutsideObstacles({ x: 20, y: 0 }, [obstacle], 36);

    expect(distance(point, obstacle)).toBeGreaterThanOrEqual(122);
  });
});
