import type { Nest } from "@main/services/hedgemony/schemas";
import { describe, expect, it } from "vitest";
import {
  applyBoxSelect,
  applyEscape,
  nextCycleNest,
  recallControlGroupSelection,
  type Selection,
  selectActiveHotkeyContext,
  selectAffiliation,
  snapshotSelectionForControlGroup,
  toggleHogletSelection,
} from "./HedgemonyController";

function makeNest(overrides: Partial<Nest> & { id: string }): Nest {
  const base: Nest = {
    id: overrides.id,
    name: `Nest ${overrides.id}`,
    goalPrompt: "Goal",
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
  };
  return { ...base, ...overrides };
}

describe("HedgemonyController", () => {
  describe("nextCycleNest", () => {
    it("returns null when no nests", () => {
      expect(nextCycleNest(null, [], 1)).toBeNull();
    });

    it("starts at first nest going forward from nothing selected", () => {
      const nests = [
        makeNest({ id: "a", mapX: 1, mapY: 2 }),
        makeNest({ id: "b" }),
      ];
      const result = nextCycleNest(null, nests, 1);
      expect(result?.selection).toEqual({ type: "nest", id: "a" });
      expect(result?.centerOn).toEqual({ x: 1, y: 2 });
    });

    it("starts at last nest going backward from nothing selected", () => {
      const nests = [
        makeNest({ id: "a" }),
        makeNest({ id: "b", mapX: 5, mapY: 6 }),
      ];
      const result = nextCycleNest(null, nests, -1);
      expect(result?.selection).toEqual({ type: "nest", id: "b" });
      expect(result?.centerOn).toEqual({ x: 5, y: 6 });
    });

    it("wraps forward from last to first", () => {
      const nests = [makeNest({ id: "a" }), makeNest({ id: "b" })];
      const result = nextCycleNest({ type: "nest", id: "b" }, nests, 1);
      expect(result?.selection).toEqual({ type: "nest", id: "a" });
    });

    it("wraps backward from first to last", () => {
      const nests = [makeNest({ id: "a" }), makeNest({ id: "b" })];
      const result = nextCycleNest({ type: "nest", id: "a" }, nests, -1);
      expect(result?.selection).toEqual({ type: "nest", id: "b" });
    });

    it("ignores non-nest selections when computing next index", () => {
      const nests = [makeNest({ id: "a" }), makeNest({ id: "b" })];
      const result = nextCycleNest({ type: "builder" }, nests, 1);
      expect(result?.selection).toEqual({ type: "nest", id: "a" });
    });
  });

  describe("toggleHogletSelection", () => {
    it("non-additive click replaces with a single-hoglet selection", () => {
      const next = toggleHogletSelection(
        { type: "hoglets", ids: ["x", "y"] },
        "z",
        false,
      );
      expect(next).toEqual({ type: "hoglets", ids: ["z"] });
    });

    it("additive click adds to existing hoglet selection", () => {
      const next = toggleHogletSelection(
        { type: "hoglets", ids: ["x"] },
        "y",
        true,
      );
      expect(next).toEqual({ type: "hoglets", ids: ["x", "y"] });
    });

    it("additive click on already-selected hoglet removes it", () => {
      const next = toggleHogletSelection(
        { type: "hoglets", ids: ["x", "y"] },
        "x",
        true,
      );
      expect(next).toEqual({ type: "hoglets", ids: ["y"] });
    });

    it("additive removal that empties selection clears it", () => {
      const next = toggleHogletSelection(
        { type: "hoglets", ids: ["x"] },
        "x",
        true,
      );
      expect(next).toBeNull();
    });

    it("additive click on non-hoglet selection still replaces", () => {
      const next = toggleHogletSelection({ type: "builder" }, "x", true);
      expect(next).toEqual({ type: "hoglets", ids: ["x"] });
    });
  });

  describe("applyBoxSelect", () => {
    it("non-additive empty marquee clears selection", () => {
      const next = applyBoxSelect(
        { type: "hoglets", ids: ["x"] },
        [],
        false,
        false,
      );
      expect(next).toBeNull();
    });

    it("non-additive marquee with builder-only selects builder", () => {
      const next = applyBoxSelect(null, [], true, false);
      expect(next).toEqual({ type: "builder" });
    });

    it("non-additive marquee with builder and hits selects hoglets+builder", () => {
      const next = applyBoxSelect(null, ["a", "b"], true, false);
      expect(next).toEqual({
        type: "hoglets",
        ids: ["a", "b"],
        includeBuilder: true,
      });
    });

    it("additive marquee preserves existing builder include", () => {
      const next = applyBoxSelect(
        { type: "hoglets", ids: ["a"], includeBuilder: true },
        ["b"],
        false,
        true,
      );
      expect(next).toEqual({
        type: "hoglets",
        ids: ["a", "b"],
        includeBuilder: true,
      });
    });

    it("additive marquee dedupes hoglet ids", () => {
      const next = applyBoxSelect(
        { type: "hoglets", ids: ["a"] },
        ["a", "b"],
        false,
        true,
      );
      expect(next).toEqual({ type: "hoglets", ids: ["a", "b"] });
    });
  });

  describe("snapshotSelectionForControlGroup", () => {
    it("rejects null selection", () => {
      expect(snapshotSelectionForControlGroup(null)).toEqual({
        kind: "nothing-selected",
      });
    });

    it("rejects money-hog selection", () => {
      expect(snapshotSelectionForControlGroup({ type: "money-hog" })).toEqual({
        kind: "nothing-selected",
      });
    });

    it("copies hoglet ids so later mutations don't leak", () => {
      const sel: Selection = { type: "hoglets", ids: ["a", "b"] };
      const result = snapshotSelectionForControlGroup(sel);
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.snapshot).toEqual({ type: "hoglets", ids: ["a", "b"] });
      // Mutating the original after snapshot must not affect the snapshot.
      sel.type === "hoglets" && sel.ids.push("c");
      expect(result.snapshot).toEqual({ type: "hoglets", ids: ["a", "b"] });
    });

    it("passes simple selections through", () => {
      expect(snapshotSelectionForControlGroup({ type: "builder" })).toEqual({
        kind: "ok",
        snapshot: { type: "builder" },
      });
      expect(
        snapshotSelectionForControlGroup({ type: "nest", id: "n" }),
      ).toEqual({ kind: "ok", snapshot: { type: "nest", id: "n" } });
    });
  });

  describe("recallControlGroupSelection", () => {
    it("returns not-saved when group is empty", () => {
      const result = recallControlGroupSelection(undefined, 1, new Set(), []);
      expect(result.kind).toBe("not-saved");
    });

    it("filters hoglets against the live ID set", () => {
      const result = recallControlGroupSelection(
        { type: "hoglets", ids: ["a", "b", "c"] },
        1,
        new Set(["a", "c"]),
        [],
      );
      expect(result).toEqual({
        kind: "ok",
        selection: {
          type: "hoglets",
          ids: ["a", "c"],
          includeBuilder: undefined,
        },
        voiceHogletId: "a",
      });
    });

    it("reports decayed when no live hoglets remain and no builder included", () => {
      const result = recallControlGroupSelection(
        { type: "hoglets", ids: ["a"] },
        2,
        new Set(),
        [],
      );
      expect(result).toEqual({ kind: "empty", slot: 2, reason: "decayed" });
    });

    it("keeps an empty hoglet selection when includeBuilder is true", () => {
      const result = recallControlGroupSelection(
        { type: "hoglets", ids: ["a"], includeBuilder: true },
        3,
        new Set(),
        [],
      );
      expect(result).toEqual({
        kind: "ok",
        selection: {
          type: "hoglets",
          ids: [],
          includeBuilder: true,
        },
        voiceHogletId: null,
      });
    });

    it("reports archived when saved nest no longer exists", () => {
      const result = recallControlGroupSelection(
        { type: "nest", id: "ghost" },
        4,
        new Set(),
        [makeNest({ id: "live" })],
      );
      expect(result).toEqual({ kind: "empty", slot: 4, reason: "archived" });
    });

    it("returns nest selection when still alive", () => {
      const result = recallControlGroupSelection(
        { type: "nest", id: "live" },
        5,
        new Set(),
        [makeNest({ id: "live" })],
      );
      expect(result).toEqual({
        kind: "ok",
        selection: { type: "nest", id: "live" },
        voiceHogletId: null,
      });
    });

    it("returns builder selection as-is", () => {
      const result = recallControlGroupSelection(
        { type: "builder" },
        6,
        new Set(),
        [],
      );
      expect(result).toEqual({
        kind: "ok",
        selection: { type: "builder" },
        voiceHogletId: null,
      });
    });
  });

  describe("applyEscape", () => {
    it("is a no-op when helper overlay is open", () => {
      const result = applyEscape({
        mode: { kind: "placingNest", creationMode: "guided" },
        selection: { type: "builder" },
        fullscreen: true,
        helperOpen: true,
      });
      expect(result.handled).toBe(false);
      expect(result.mode.kind).toBe("placingNest");
      expect(result.selection).toEqual({ type: "builder" });
      expect(result.exitFullscreen).toBe(false);
    });

    it("unwinds placement first", () => {
      const result = applyEscape({
        mode: { kind: "placingNest", creationMode: "simple" },
        selection: { type: "builder" },
        fullscreen: true,
        helperOpen: false,
      });
      expect(result.handled).toBe(true);
      expect(result.mode).toEqual({ kind: "browsing" });
      expect(result.selection).toEqual({ type: "builder" });
      expect(result.exitFullscreen).toBe(false);
    });

    it("exits fullscreen next", () => {
      const result = applyEscape({
        mode: { kind: "browsing" },
        selection: { type: "builder" },
        fullscreen: true,
        helperOpen: false,
      });
      expect(result.handled).toBe(true);
      expect(result.exitFullscreen).toBe(true);
      expect(result.selection).toEqual({ type: "builder" });
    });

    it("clears selection last", () => {
      const result = applyEscape({
        mode: { kind: "browsing" },
        selection: { type: "nest", id: "a" },
        fullscreen: false,
        helperOpen: false,
      });
      expect(result.handled).toBe(true);
      expect(result.selection).toBeNull();
    });

    it("is a no-op when everything is already clear", () => {
      const result = applyEscape({
        mode: { kind: "browsing" },
        selection: null,
        fullscreen: false,
        helperOpen: false,
      });
      expect(result.handled).toBe(false);
    });
  });

  describe("selectActiveHotkeyContext", () => {
    it("returns 'dialog' when a dialog is open even if a nest is selected", () => {
      expect(
        selectActiveHotkeyContext({
          dialogOpen: true,
          activeNestId: "n",
          builderSelected: false,
          hedgehouseSelected: false,
          singleSelectedHogletId: null,
        }),
      ).toBe("dialog");
    });

    it("returns 'nest' when only a nest is selected", () => {
      expect(
        selectActiveHotkeyContext({
          dialogOpen: false,
          activeNestId: "n",
          builderSelected: false,
          hedgehouseSelected: false,
          singleSelectedHogletId: null,
        }),
      ).toBe("nest");
    });

    it("returns null when nothing is selected", () => {
      expect(
        selectActiveHotkeyContext({
          dialogOpen: false,
          activeNestId: null,
          builderSelected: false,
          hedgehouseSelected: false,
          singleSelectedHogletId: null,
        }),
      ).toBeNull();
    });
  });

  describe("selectAffiliation", () => {
    it("returns null affiliation when no selection", () => {
      expect(selectAffiliation(null, {})).toEqual({
        affiliatedNestIds: null,
        dimWildFlock: false,
      });
    });

    it("highlights only the selected nest", () => {
      const result = selectAffiliation({ type: "nest", id: "a" }, {});
      expect(result.affiliatedNestIds).toEqual(new Set(["a"]));
      expect(result.dimWildFlock).toBe(true);
    });

    it("highlights parent nests of selected hoglets", () => {
      const result = selectAffiliation(
        { type: "hoglets", ids: ["h1", "h2"] },
        {
          nestA: [
            { id: "h1", nestId: "nestA" },
            { id: "h2", nestId: "nestA" },
          ],
        },
      );
      expect(result.affiliatedNestIds).toEqual(new Set(["nestA"]));
      expect(result.dimWildFlock).toBe(true);
    });

    it("keeps wild flock visible when at least one wild hoglet is selected", () => {
      const result = selectAffiliation(
        { type: "hoglets", ids: ["h1"] },
        { wild: [{ id: "h1", nestId: null }] },
      );
      expect(result.affiliatedNestIds).toEqual(new Set());
      expect(result.dimWildFlock).toBe(false);
    });
  });
});
