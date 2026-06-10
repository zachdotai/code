import type { Nest } from "@posthog/host-router/rts-schemas";
import { describe, expect, it } from "vitest";
import { computeMapClickAction, type ViewMode } from "./computeMapClickAction";

function makeNest(id: string, overrides: Partial<Nest> = {}): Nest {
  return {
    id,
    name: `Nest ${id}`,
    goalPrompt: "",
    definitionOfDone: null,
    mapX: 0,
    mapY: 0,
    status: "active",
    health: "ok",
    targetMetricId: null,
    loadoutJson: null,
    primaryRepository: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeMapClickAction", () => {
  describe("browsing mode", () => {
    it("clears selection without changing mode", () => {
      const mode: ViewMode = { kind: "browsing" };
      const result = computeMapClickAction({
        mode,
        click: { x: 100, y: 50 },
        nests: [],
      });
      expect(result.nextMode).toEqual({ kind: "browsing" });
      expect(result.action).toEqual({ kind: "clearSelection" });
    });
  });

  describe("placingNest mode", () => {
    it("emits placeNest with guided creation mode and returns to browsing", () => {
      const mode: ViewMode = {
        kind: "placingNest",
        creationMode: "guided",
      };
      const result = computeMapClickAction({
        mode,
        click: { x: 100, y: 50 },
        nests: [],
      });
      expect(result.nextMode).toEqual({ kind: "browsing" });
      expect(result.action).toEqual({
        kind: "placeNest",
        x: 100,
        y: 50,
        creationMode: "guided",
      });
    });

    it("emits placeNest with simple creation mode", () => {
      const mode: ViewMode = {
        kind: "placingNest",
        creationMode: "simple",
      };
      const result = computeMapClickAction({
        mode,
        click: { x: -10, y: 200 },
        nests: [],
      });
      expect(result.action).toEqual({
        kind: "placeNest",
        x: -10,
        y: 200,
        creationMode: "simple",
      });
    });

    it("preserves fractional click coordinates for placement", () => {
      const mode: ViewMode = {
        kind: "placingNest",
        creationMode: "guided",
      };
      const result = computeMapClickAction({
        mode,
        click: { x: 12.7, y: 33.4 },
        nests: [],
      });
      expect(result.action).toMatchObject({ x: 12.7, y: 33.4 });
    });
  });

  describe("relocatingNest mode", () => {
    it("emits moveNest with rounded coords when nest exists", () => {
      const nest = makeNest("n1");
      const mode: ViewMode = { kind: "relocatingNest", nestId: "n1" };
      const result = computeMapClickAction({
        mode,
        click: { x: 100.6, y: -50.4 },
        nests: [nest],
      });
      expect(result.nextMode).toEqual({ kind: "browsing" });
      expect(result.action).toEqual({
        kind: "moveNest",
        nest,
        mapX: 101,
        mapY: -50,
      });
    });

    it("noops and returns to browsing when nest is missing", () => {
      const mode: ViewMode = {
        kind: "relocatingNest",
        nestId: "missing",
      };
      const result = computeMapClickAction({
        mode,
        click: { x: 100, y: 50 },
        nests: [makeNest("other")],
      });
      expect(result.nextMode).toEqual({ kind: "browsing" });
      expect(result.action).toEqual({ kind: "noop" });
    });

    it("finds the correct nest among many", () => {
      const target = makeNest("target", { name: "Target" });
      const result = computeMapClickAction({
        mode: { kind: "relocatingNest", nestId: "target" },
        click: { x: 10, y: 20 },
        nests: [makeNest("a"), target, makeNest("b")],
      });
      expect(result.action).toMatchObject({
        kind: "moveNest",
        nest: target,
      });
    });
  });
});
