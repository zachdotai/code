import { describe, expect, it } from "vitest";
import { findPath, type Obstacle, type Vec2 } from "./pathfinding";

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
});
