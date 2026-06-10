import { describe, expect, it } from "vitest";
import { clientToWorld, fitZoom, panToCenter } from "./coordinates";

function makeRect(width = 1000, height = 600): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  };
}

describe("clientToWorld", () => {
  it("treats the rect center as the world origin at default pan/zoom", () => {
    const rect = makeRect(1000, 600);
    expect(clientToWorld(500, 300, rect, 0, 0, 1)).toEqual({ x: 0, y: 0 });
  });

  it("inverts pan and zoom", () => {
    const rect = makeRect(1000, 600);
    // Pan = (100, 50), zoom = 2 means a click at the visible center maps
    // to world (-pan / zoom).
    expect(clientToWorld(500, 300, rect, 100, 50, 2)).toEqual({
      x: -50,
      y: -25,
    });
  });

  it("offsets by rect.left / rect.top", () => {
    const rect: DOMRect = { ...makeRect(400, 200), left: 200, top: 100 };
    expect(clientToWorld(400, 200, rect, 0, 0, 1)).toEqual({ x: 0, y: 0 });
  });
});

describe("panToCenter", () => {
  it("returns the pan that places a world point at the surface center", () => {
    expect(panToCenter(100, 50, 1)).toEqual({ x: -100, y: -50 });
    expect(panToCenter(100, 50, 2)).toEqual({ x: -200, y: -100 });
  });
});

describe("fitZoom", () => {
  it("returns 1 when content matches viewport", () => {
    expect(fitZoom(1000, 600, 1000, 600, 0.1, 4)).toBe(1);
  });

  it("scales down to fit larger content", () => {
    expect(fitZoom(2000, 600, 1000, 600, 0.1, 4)).toBe(0.5);
  });

  it("does not scale up past the cap when content is tiny", () => {
    expect(fitZoom(100, 60, 1000, 600, 0.1, 4, 1.25)).toBe(1.25);
  });

  it("respects the min clamp when content is enormous", () => {
    expect(fitZoom(100000, 60000, 1000, 600, 0.2, 4)).toBe(0.2);
  });
});
