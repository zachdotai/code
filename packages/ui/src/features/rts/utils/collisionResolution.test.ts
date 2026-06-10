import { afterEach, describe, expect, it } from "vitest";
import {
  clearCollisionEntitiesForTest,
  getCollisionEntityCountForTest,
  registerCollisionEntityForTest,
  stepCollisionResolutionForTest,
} from "./collisionResolution";
import { clearHogletVisualPositionsForTest } from "./hogletVisualPositions";
import type { Obstacle } from "./pathfinding";

function stub(initial = 0): {
  get(): number;
  set(v: number): void;
  value: number;
} {
  return {
    value: initial,
    get() {
      return this.value;
    },
    set(v: number) {
      this.value = v;
    },
  };
}

const HOGLET_RADIUS = 44;

describe("collision resolution", () => {
  afterEach(() => {
    clearCollisionEntitiesForTest();
    clearHogletVisualPositionsForTest();
  });

  it("pushes two overlapping units apart so they're at least 2 * radius apart", () => {
    const aMx = stub(0);
    const aMy = stub(0);
    const aOx = stub(0);
    const aOy = stub(0);
    const bMx = stub(20);
    const bMy = stub(0);
    const bOx = stub(0);
    const bOy = stub(0);

    registerCollisionEntityForTest({
      id: "a",
      motionX: aMx,
      motionY: aMy,
      offsetX: aOx,
      offsetY: aOy,
      radius: HOGLET_RADIUS,
    });
    registerCollisionEntityForTest({
      id: "b",
      motionX: bMx,
      motionY: bMy,
      offsetX: bOx,
      offsetY: bOy,
      radius: HOGLET_RADIUS,
    });

    stepCollisionResolutionForTest();

    const aX = aMx.get() + aOx.get();
    const aY = aMy.get() + aOy.get();
    const bX = bMx.get() + bOx.get();
    const bY = bMy.get() + bOy.get();
    expect(Math.hypot(bX - aX, bY - aY)).toBeGreaterThanOrEqual(
      HOGLET_RADIUS * 2,
    );
  });

  it("breaks the symmetric stack deterministically", () => {
    const aMx = stub(0);
    const aMy = stub(0);
    const aOx = stub(0);
    const aOy = stub(0);
    const bMx = stub(0);
    const bMy = stub(0);
    const bOx = stub(0);
    const bOy = stub(0);

    registerCollisionEntityForTest({
      id: "alpha",
      motionX: aMx,
      motionY: aMy,
      offsetX: aOx,
      offsetY: aOy,
      radius: HOGLET_RADIUS,
    });
    registerCollisionEntityForTest({
      id: "bravo",
      motionX: bMx,
      motionY: bMy,
      offsetX: bOx,
      offsetY: bOy,
      radius: HOGLET_RADIUS,
    });

    stepCollisionResolutionForTest();
    const sep1 = Math.hypot(
      bMx.get() + bOx.get() - (aMx.get() + aOx.get()),
      bMy.get() + bOy.get() - (aMy.get() + aOy.get()),
    );
    expect(sep1).toBeGreaterThan(0);
  });

  it("snaps the resolved position outside a static obstacle", () => {
    const mx = stub(20);
    const my = stub(0);
    const ox = stub(0);
    const oy = stub(0);
    const obstacle: Obstacle = { x: 0, y: 0, radius: 86 };

    registerCollisionEntityForTest({
      id: "a",
      motionX: mx,
      motionY: my,
      offsetX: ox,
      offsetY: oy,
      radius: HOGLET_RADIUS,
      getStaticObstacles: () => [obstacle],
    });

    stepCollisionResolutionForTest();

    const finalX = mx.get() + ox.get();
    const finalY = my.get() + oy.get();
    // Inflated radius for a hoglet-sized agent
    expect(Math.hypot(finalX, finalY)).toBeGreaterThanOrEqual(
      obstacle.radius + HOGLET_RADIUS - 0.5,
    );
  });

  it("writes the resolved position to the visual registry when requested", async () => {
    const { getHogletVisualPosition } = await import("./hogletVisualPositions");
    const mx = stub(100);
    const my = stub(200);
    const ox = stub(0);
    const oy = stub(0);

    registerCollisionEntityForTest({
      id: "a",
      motionX: mx,
      motionY: my,
      offsetX: ox,
      offsetY: oy,
      radius: HOGLET_RADIUS,
      visualRegistryId: "hg-1",
    });

    stepCollisionResolutionForTest();
    expect(getHogletVisualPosition("hg-1")).toEqual({ x: 100, y: 200 });
  });

  it("clearCollisionEntitiesForTest empties the registry", () => {
    const mx = stub(0);
    const my = stub(0);
    const ox = stub(0);
    const oy = stub(0);

    registerCollisionEntityForTest({
      id: "a",
      motionX: mx,
      motionY: my,
      offsetX: ox,
      offsetY: oy,
      radius: HOGLET_RADIUS,
    });
    expect(getCollisionEntityCountForTest()).toBe(1);

    clearCollisionEntitiesForTest();
    expect(getCollisionEntityCountForTest()).toBe(0);
  });
});
