import { describe, expect, it } from "vitest";
import {
  closePane,
  ensureSnapshotIntegrity,
  moveTabToPane,
  openOrFocusTab,
  POSITION_GAP,
  paneTabs,
  setFocusedPane,
  setPaneActiveTab,
  setPaneSizes,
  splitPane,
  windowPaneIds,
} from "./browser-tabs";
import type {
  BrowserPane,
  BrowserTab,
  PaneLayoutNode,
  TabsSnapshot,
} from "./browser-tabs-schemas";

let idCounter = 0;
const makeId = () => `id-${++idCounter}`;
let clock = 0;
const now = () => ++clock;

type WindowSpec = {
  id: string;
  isPrimary?: boolean;
  panes: string[];
  focusedPaneId?: string;
};

/** Build a snapshot: each window gets a pane row per pane id, a leaf layout for
 * a single pane or a row split for several, and focus on its first pane. */
function snap(
  specs: WindowSpec[] = [{ id: "w1", panes: ["p1"] }],
): TabsSnapshot {
  const panes: BrowserPane[] = [];
  const windows = specs.map((spec, i) => {
    for (const paneId of spec.panes) {
      panes.push({
        id: paneId,
        windowId: spec.id,
        activeTabId: null,
        createdAt: 0,
      });
    }
    const layout: PaneLayoutNode =
      spec.panes.length === 1
        ? { type: "leaf", paneId: spec.panes[0] }
        : {
            type: "split",
            direction: "row",
            children: spec.panes.map((paneId) => ({
              type: "leaf" as const,
              paneId,
            })),
            sizes: spec.panes.map(() => 1 / spec.panes.length),
          };
    return {
      id: spec.id,
      isPrimary: spec.isPrimary ?? i === 0,
      bounds: null,
      layout,
      focusedPaneId: spec.focusedPaneId ?? spec.panes[0],
    };
  });
  return { windows, panes, tabs: [] };
}

/** A fully-specified tab row for hand-built (integrity) fixtures. */
function tab(
  id: string,
  windowId: string,
  paneId: string,
  over: Partial<BrowserTab> = {},
): BrowserTab {
  return {
    id,
    windowId,
    paneId,
    dashboardId: null,
    taskId: null,
    channelId: null,
    channelSection: null,
    appView: null,
    position: POSITION_GAP,
    scrollState: null,
    createdAt: 0,
    lastActiveAt: 0,
    ...over,
  };
}

function paneActive(s: TabsSnapshot, paneId: string): string | null {
  return s.panes.find((p) => p.id === paneId)?.activeTabId ?? null;
}

function focusedPaneIdOf(s: TabsSnapshot, windowId = "w1"): string | undefined {
  return s.windows.find((w) => w.id === windowId)?.focusedPaneId;
}

function open(s: TabsSnapshot, paneId: string, dashboardId: string) {
  return openOrFocusTab(s, {
    paneId,
    dashboardId,
    taskId: null,
    channelId: "c1",
    makeId,
    now,
  });
}

describe("splitPane", () => {
  /** One pane p1 with tabs a, b (b active). */
  function twoTabs() {
    const a = open(snap(), "p1", "dash-a");
    const b = open(a.snapshot, "p1", "dash-b");
    return { s: b.snapshot, a: a.tabId, b: b.tabId };
  }

  it("creates a pane next to the target holding the dragged tab and focuses it", () => {
    const { s, a, b } = twoTabs();
    const r = splitPane(s, {
      windowId: "w1",
      targetPaneId: "p1",
      direction: "right",
      tabId: b,
      newPaneId: "p2",
      now,
    });
    expect(r.paneId).toBe("p2");
    expect(r.snapshot.windows[0].layout).toEqual({
      type: "split",
      direction: "row",
      children: [
        { type: "leaf", paneId: "p1" },
        { type: "leaf", paneId: "p2" },
      ],
      sizes: [0.5, 0.5],
    });
    expect(focusedPaneIdOf(r.snapshot)).toBe("p2");
    const moved = r.snapshot.tabs.find((t) => t.id === b);
    expect(moved?.paneId).toBe("p2");
    expect(moved?.position).toBe(POSITION_GAP);
    expect(paneActive(r.snapshot, "p2")).toBe(b);
    // Source succession: the dragged tab was p1's active tab → a takes over.
    expect(paneActive(r.snapshot, "p1")).toBe(a);
  });

  it("keeps the source pane's active tab when a non-active tab is dragged", () => {
    const { s, a, b } = twoTabs(); // active = b
    const r = splitPane(s, {
      windowId: "w1",
      targetPaneId: "p1",
      direction: "bottom",
      tabId: a,
      newPaneId: "p2",
      now,
    });
    expect(paneActive(r.snapshot, "p1")).toBe(b);
    expect(paneActive(r.snapshot, "p2")).toBe(a);
    const layout = r.snapshot.windows[0].layout;
    expect(layout.type).toBe("split");
    if (layout.type === "split") expect(layout.direction).toBe("column");
  });

  it("collapses the source pane when the split empties it", () => {
    const s0 = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    const a = open(s0, "p1", "dash-a");
    const b = open(a.snapshot, "p2", "dash-b");
    const r = splitPane(b.snapshot, {
      windowId: "w1",
      targetPaneId: "p2",
      direction: "bottom",
      tabId: a.tabId,
      newPaneId: "p3",
      now,
    });
    expect(r.snapshot.panes.map((p) => p.id).sort()).toEqual(["p2", "p3"]);
    expect(r.snapshot.windows[0].layout).toEqual({
      type: "split",
      direction: "column",
      children: [
        { type: "leaf", paneId: "p2" },
        { type: "leaf", paneId: "p3" },
      ],
      sizes: [0.5, 0.5],
    });
    expect(focusedPaneIdOf(r.snapshot)).toBe("p3");
  });

  it("replays idempotently on the same newPaneId", () => {
    const { s, b } = twoTabs();
    const input = {
      windowId: "w1",
      targetPaneId: "p1",
      direction: "right" as const,
      tabId: b,
      newPaneId: "p2",
      now,
    };
    const first = splitPane(s, input);
    const replay = splitPane(first.snapshot, input);
    expect(replay.snapshot).toBe(first.snapshot);
    expect(replay.paneId).toBe("p2");
  });

  it("is a no-op when a pane's sole tab targets its own pane", () => {
    const a = open(snap(), "p1", "dash-a");
    const r = splitPane(a.snapshot, {
      windowId: "w1",
      targetPaneId: "p1",
      direction: "right",
      tabId: a.tabId,
      newPaneId: "p2",
      now,
    });
    expect(r.snapshot).toBe(a.snapshot);
    expect(r.paneId).toBe("p1");
  });

  it("is a no-op when a pane's sole tab targets the single-pane root", () => {
    const a = open(snap(), "p1", "dash-a");
    const r = splitPane(a.snapshot, {
      windowId: "w1",
      targetPaneId: null,
      direction: "bottom",
      tabId: a.tabId,
      newPaneId: "p2",
      now,
    });
    expect(r.snapshot).toBe(a.snapshot);
    expect(r.paneId).toBe("p1");
  });

  it("splits against the window root (targetPaneId null)", () => {
    const { s, a, b } = twoTabs();
    const r = splitPane(s, {
      windowId: "w1",
      targetPaneId: null,
      direction: "right",
      tabId: a,
      newPaneId: "p2",
      now,
    });
    expect(windowPaneIds(r.snapshot, "w1")).toEqual(["p1", "p2"]);
    expect(paneTabs(r.snapshot, "p1").map((t) => t.id)).toEqual([b]);
    expect(paneTabs(r.snapshot, "p2").map((t) => t.id)).toEqual([a]);
    expect(focusedPaneIdOf(r.snapshot)).toBe("p2");
  });

  it("is a no-op when the target pane belongs to another window", () => {
    const s0 = snap([
      { id: "w1", panes: ["p1"] },
      { id: "w2", isPrimary: false, panes: ["p2"] },
    ]);
    const a = open(s0, "p1", "dash-a");
    const b = open(a.snapshot, "p1", "dash-b");
    const r = splitPane(b.snapshot, {
      windowId: "w1",
      targetPaneId: "p2",
      direction: "right",
      tabId: a.tabId,
      newPaneId: "p3",
      now,
    });
    expect(r.snapshot).toBe(b.snapshot);
  });

  it("is a no-op for an unknown tab", () => {
    const a = open(snap(), "p1", "dash-a");
    const r = splitPane(a.snapshot, {
      windowId: "w1",
      targetPaneId: "p1",
      direction: "right",
      tabId: "nope",
      newPaneId: "p2",
      now,
    });
    expect(r.snapshot).toBe(a.snapshot);
  });
});

describe("moveTabToPane", () => {
  /** Two panes: p1 holds a,b (b active); p2 holds x,y (y active). */
  function fixture() {
    const s0 = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    const a = open(s0, "p1", "dash-a");
    const b = open(a.snapshot, "p1", "dash-b");
    const x = open(b.snapshot, "p2", "dash-x");
    const y = open(x.snapshot, "p2", "dash-y");
    return { s: y.snapshot, a: a.tabId, b: b.tabId, x: x.tabId, y: y.tabId };
  }

  it("appends at the destination's tail by default", () => {
    const { s, a, x, y } = fixture();
    const r = moveTabToPane(s, { tabId: a, toPaneId: "p2", now });
    expect(paneTabs(r, "p2").map((t) => t.id)).toEqual([x, y, a]);
    expect(paneTabs(r, "p2").map((t) => t.position)).toEqual([
      POSITION_GAP,
      2 * POSITION_GAP,
      3 * POSITION_GAP,
    ]);
  });

  it.each([
    [0, ["moved", "x", "y"]],
    [1, ["x", "moved", "y"]],
    [2, ["x", "y", "moved"]],
  ])("inserts at displayed index %i", (index, expected) => {
    const { s, a, x, y } = fixture();
    const names = new Map([
      [a, "moved"],
      [x, "x"],
      [y, "y"],
    ]);
    const r = moveTabToPane(s, { tabId: a, toPaneId: "p2", index, now });
    expect(paneTabs(r, "p2").map((t) => names.get(t.id))).toEqual(expected);
  });

  it("makes the moved tab the destination's active tab and focuses the pane", () => {
    const { s, a } = fixture();
    const r = moveTabToPane(s, { tabId: a, toPaneId: "p2", now });
    expect(paneActive(r, "p2")).toBe(a);
    expect(focusedPaneIdOf(r)).toBe("p2");
    const moved = r.tabs.find((t) => t.id === a);
    expect(moved?.paneId).toBe("p2");
    expect(moved?.windowId).toBe("w1");
  });

  it("runs source succession when the moved tab was active", () => {
    const { s, a, b } = fixture(); // p1 active = b
    const r = moveTabToPane(s, { tabId: b, toPaneId: "p2", now });
    expect(paneActive(r, "p1")).toBe(a);
  });

  it("collapses the source pane when the move empties it", () => {
    const s0 = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    const a = open(s0, "p1", "dash-a");
    const x = open(a.snapshot, "p2", "dash-x");
    const r = moveTabToPane(x.snapshot, {
      tabId: x.tabId,
      toPaneId: "p1",
      now,
    });
    expect(r.panes.map((p) => p.id)).toEqual(["p1"]);
    expect(r.windows[0].layout).toEqual({ type: "leaf", paneId: "p1" });
    expect(windowPaneIds(r, "w1")).toEqual(["p1"]);
  });

  it("is a no-op when the destination is the tab's own pane", () => {
    const { s, a } = fixture();
    expect(moveTabToPane(s, { tabId: a, toPaneId: "p1", now })).toBe(s);
  });

  it("is a no-op for an unknown tab or pane", () => {
    const { s, a } = fixture();
    expect(moveTabToPane(s, { tabId: "nope", toPaneId: "p2", now })).toBe(s);
    expect(moveTabToPane(s, { tabId: a, toPaneId: "p-nope", now })).toBe(s);
  });
});

describe("closePane", () => {
  it("closes all of the pane's tabs and collapses its leaf", () => {
    const s0 = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    const a = open(s0, "p1", "dash-a");
    const b = open(a.snapshot, "p1", "dash-b");
    const x = open(b.snapshot, "p2", "dash-x");
    const r = closePane(x.snapshot, {
      windowId: "w1",
      paneId: "p1",
      makeId,
      now,
    });
    expect(r.closedWindowId).toBeNull();
    expect(r.snapshot.tabs.map((t) => t.id)).toEqual([x.tabId]);
    expect(r.snapshot.panes.map((p) => p.id)).toEqual(["p2"]);
    expect(r.snapshot.windows[0].layout).toEqual({
      type: "leaf",
      paneId: "p2",
    });
  });

  it("moves focus to the first remaining leaf when the focused pane closes", () => {
    const s0 = snap([
      { id: "w1", panes: ["p1", "p2", "p3"], focusedPaneId: "p2" },
    ]);
    const a = open(s0, "p1", "dash-a");
    const b = open(a.snapshot, "p2", "dash-b");
    const c = open(b.snapshot, "p3", "dash-c");
    const focused = setFocusedPane(c.snapshot, "w1", "p2");
    const r = closePane(focused, { windowId: "w1", paneId: "p2", makeId, now });
    expect(focusedPaneIdOf(r.snapshot)).toBe("p1");
    expect(windowPaneIds(r.snapshot, "w1")).toEqual(["p1", "p3"]);
  });

  it("keeps focus where it was when a non-focused pane closes", () => {
    const s0 = snap([{ id: "w1", panes: ["p1", "p2", "p3"] }]);
    const a = open(s0, "p1", "dash-a");
    const b = open(a.snapshot, "p2", "dash-b");
    const c = open(b.snapshot, "p3", "dash-c");
    const focused = setFocusedPane(c.snapshot, "w1", "p3");
    const r = closePane(focused, { windowId: "w1", paneId: "p2", makeId, now });
    expect(focusedPaneIdOf(r.snapshot)).toBe("p3");
  });

  it("closes a secondary window when its last pane closes", () => {
    const s0 = snap([
      { id: "w1", panes: ["p1"] },
      { id: "w2", isPrimary: false, panes: ["p2"] },
    ]);
    const x = open(s0, "p2", "dash-x");
    const r = closePane(x.snapshot, {
      windowId: "w2",
      paneId: "p2",
      makeId,
      now,
    });
    expect(r.closedWindowId).toBe("w2");
    expect(r.snapshot.windows.map((w) => w.id)).toEqual(["w1"]);
    expect(r.snapshot.panes.map((p) => p.id)).toEqual(["p1"]);
    expect(r.snapshot.tabs).toHaveLength(0);
  });

  it("resets the primary window's last pane to a fresh blank tab (blankTabId)", () => {
    const a = open(snap(), "p1", "dash-a");
    const b = open(a.snapshot, "p1", "dash-b");
    const r = closePane(b.snapshot, {
      windowId: "w1",
      paneId: "p1",
      makeId,
      now,
      blankTabId: "blank-7",
    });
    expect(r.closedWindowId).toBeNull();
    expect(r.snapshot.tabs.map((t) => t.id)).toEqual(["blank-7"]);
    expect(r.snapshot.tabs[0].dashboardId).toBeNull();
    expect(paneActive(r.snapshot, "p1")).toBe("blank-7");
    expect(r.snapshot.panes.map((p) => p.id)).toEqual(["p1"]);
  });

  it("mints the primary reset blank with makeId when no blankTabId is given", () => {
    const a = open(snap(), "p1", "dash-a");
    const r = closePane(a.snapshot, {
      windowId: "w1",
      paneId: "p1",
      makeId: () => "made-2",
      now,
    });
    expect(r.snapshot.tabs.map((t) => t.id)).toEqual(["made-2"]);
  });

  it("is a no-op for an unknown pane or a pane of another window", () => {
    const s0 = snap([
      { id: "w1", panes: ["p1"] },
      { id: "w2", isPrimary: false, panes: ["p2"] },
    ]);
    const a = open(s0, "p1", "dash-a");
    const unknown = closePane(a.snapshot, {
      windowId: "w1",
      paneId: "p-nope",
      makeId,
      now,
    });
    expect(unknown.snapshot).toBe(a.snapshot);
    const crossWindow = closePane(a.snapshot, {
      windowId: "w1",
      paneId: "p2",
      makeId,
      now,
    });
    expect(crossWindow.snapshot).toBe(a.snapshot);
  });
});

describe("setFocusedPane", () => {
  it("focuses a live leaf pane of the window", () => {
    const s = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    const next = setFocusedPane(s, "w1", "p2");
    expect(focusedPaneIdOf(next)).toBe("p2");
    expect(next.panes).toBe(s.panes);
    expect(next.tabs).toBe(s.tabs);
  });

  it("is a no-op when the pane is already focused", () => {
    const s = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    expect(setFocusedPane(s, "w1", "p1")).toBe(s);
  });

  it("is a no-op for an unknown window", () => {
    const s = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    expect(setFocusedPane(s, "w-nope", "p2")).toBe(s);
  });

  it("is a no-op for a pane of another window", () => {
    const s = snap([
      { id: "w1", panes: ["p1"] },
      { id: "w2", isPrimary: false, panes: ["p2"] },
    ]);
    expect(setFocusedPane(s, "w1", "p2")).toBe(s);
  });

  it("is a no-op for a pane row that is not a live layout leaf", () => {
    const s = snap([{ id: "w1", panes: ["p1"] }]);
    const withGhost: TabsSnapshot = {
      ...s,
      panes: [
        ...s.panes,
        { id: "p-ghost", windowId: "w1", activeTabId: null, createdAt: 0 },
      ],
    };
    expect(setFocusedPane(withGhost, "w1", "p-ghost")).toBe(withGhost);
  });
});

describe("setPaneSizes", () => {
  it("resizes the addressed split", () => {
    const s = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    const next = setPaneSizes(s, "w1", [], [3, 1]);
    const layout = next.windows[0].layout;
    expect(layout.type).toBe("split");
    if (layout.type === "split") {
      expect(layout.sizes[0]).toBeCloseTo(0.75, 10);
      expect(layout.sizes[1]).toBeCloseTo(0.25, 10);
    }
  });

  it("is a no-op for an unknown window or invalid sizes", () => {
    const s = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    expect(setPaneSizes(s, "w-nope", [], [3, 1])).toBe(s);
    expect(setPaneSizes(s, "w1", [], [1, 0])).toBe(s);
    expect(setPaneSizes(s, "w1", [4], [1, 1])).toBe(s);
  });
});

describe("ensureSnapshotIntegrity", () => {
  it("synthesizes a primary window with a pane and a blank tab when none exists", () => {
    const healed = ensureSnapshotIntegrity(
      { windows: [], panes: [], tabs: [] },
      { makeId, now },
    );
    expect(healed.windows).toHaveLength(1);
    const w = healed.windows[0];
    expect(w.isPrimary).toBe(true);
    expect(w.layout.type).toBe("leaf");
    expect(healed.panes).toHaveLength(1);
    expect(healed.panes[0].windowId).toBe(w.id);
    expect(healed.tabs).toHaveLength(1);
    expect(healed.tabs[0].paneId).toBe(healed.panes[0].id);
    expect(healed.tabs[0].dashboardId).toBeNull();
    expect(healed.panes[0].activeTabId).toBe(healed.tabs[0].id);
    expect(w.focusedPaneId).toBe(healed.panes[0].id);
  });

  it("keeps a secondary-only snapshot's window and prepends a primary", () => {
    const s = snap([{ id: "w2", isPrimary: false, panes: ["p2"] }]);
    const withTab: TabsSnapshot = {
      ...s,
      panes: s.panes.map((p) => ({ ...p, activeTabId: "t1" })),
      tabs: [tab("t1", "w2", "p2")],
    };
    const healed = ensureSnapshotIntegrity(withTab, { makeId, now });
    expect(healed.windows).toHaveLength(2);
    expect(healed.windows[0].isPrimary).toBe(true);
    expect(healed.windows[1].id).toBe("w2");
    expect(healed.tabs.some((t) => t.id === "t1")).toBe(true);
  });

  it("replaces an empty layout with a leaf reusing the window's existing pane", () => {
    const s = snap();
    const broken: TabsSnapshot = {
      ...s,
      windows: s.windows.map((w) => ({
        ...w,
        layout: {
          type: "split",
          direction: "row",
          children: [],
          sizes: [],
        } as PaneLayoutNode,
      })),
    };
    const healed = ensureSnapshotIntegrity(broken, { makeId, now });
    expect(healed.windows[0].layout).toEqual({ type: "leaf", paneId: "p1" });
    expect(healed.panes.map((p) => p.id)).toEqual(["p1"]);
    expect(healed.tabs.some((t) => t.paneId === "p1")).toBe(true);
  });

  it("gives a window with an unparsable layout a fresh pane and leaf", () => {
    const broken: TabsSnapshot = {
      windows: [
        {
          id: "w1",
          isPrimary: true,
          bounds: null,
          layout: undefined as unknown as PaneLayoutNode,
          focusedPaneId: "",
        },
      ],
      panes: [],
      tabs: [],
    };
    const healed = ensureSnapshotIntegrity(broken, { makeId, now });
    expect(healed.windows[0].layout.type).toBe("leaf");
    expect(healed.panes).toHaveLength(1);
    expect(healed.windows[0].focusedPaneId).toBe(healed.panes[0].id);
    expect(healed.tabs).toHaveLength(1);
  });

  it("synthesizes a pane row for a layout leaf without one", () => {
    const s = snap();
    const broken: TabsSnapshot = { ...s, panes: [] };
    const healed = ensureSnapshotIntegrity(broken, { makeId, now });
    expect(healed.panes.map((p) => p.id)).toEqual(["p1"]);
    expect(healed.panes[0].windowId).toBe("w1");
  });

  it("removes an orphan pane row and grafts its tabs onto the first pane", () => {
    const s = snap();
    const broken: TabsSnapshot = {
      ...s,
      panes: [
        ...s.panes,
        { id: "p-orphan", windowId: "w1", activeTabId: "t2", createdAt: 0 },
      ],
      tabs: [tab("t1", "w1", "p1"), tab("t2", "w1", "p-orphan")],
    };
    const healed = ensureSnapshotIntegrity(broken, { makeId, now });
    expect(healed.panes.map((p) => p.id)).toEqual(["p1"]);
    // Healing never deletes tabs: t2 survives, grafted onto p1.
    expect(healed.tabs.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    expect(healed.tabs.every((t) => t.paneId === "p1")).toBe(true);
  });

  it("reassigns a tab with a dangling paneId to its window's first pane", () => {
    const s = snap();
    const broken: TabsSnapshot = {
      ...s,
      tabs: [tab("t1", "w1", "p1"), tab("t2", "w1", "p-ghost")],
    };
    const healed = ensureSnapshotIntegrity(broken, { makeId, now });
    expect(healed.tabs.find((t) => t.id === "t2")?.paneId).toBe("p1");
  });

  it("drops a tab whose pane and window are both dead", () => {
    const s = snap();
    const broken: TabsSnapshot = {
      ...s,
      tabs: [tab("t1", "w1", "p1"), tab("t2", "w-dead", "p-ghost")],
    };
    const healed = ensureSnapshotIntegrity(broken, { makeId, now });
    expect(healed.tabs.map((t) => t.id)).toEqual(["t1"]);
  });

  it("rewrites tab.windowId from its pane's window", () => {
    const s = snap([
      { id: "w1", panes: ["p1"] },
      { id: "w2", isPrimary: false, panes: ["p2"] },
    ]);
    const broken: TabsSnapshot = {
      ...s,
      tabs: [tab("t1", "w2", "p1"), tab("t2", "w2", "p2")],
    };
    const healed = ensureSnapshotIntegrity(broken, { makeId, now });
    expect(healed.tabs.find((t) => t.id === "t1")?.windowId).toBe("w1");
    expect(healed.tabs.find((t) => t.id === "t2")?.windowId).toBe("w2");
  });

  it("backfills an empty pane with a blank tab without stealing window focus", () => {
    const s = snap([{ id: "w1", panes: ["p1", "p2"] }]); // focused: p1
    const broken: TabsSnapshot = {
      ...s,
      panes: s.panes.map((p) =>
        p.id === "p1" ? { ...p, activeTabId: "t1" } : p,
      ),
      tabs: [tab("t1", "w1", "p1", { lastActiveAt: 1 })],
    };
    const healed = ensureSnapshotIntegrity(broken, { makeId, now });
    const blank = healed.tabs.find((t) => t.paneId === "p2");
    expect(blank).toBeDefined();
    expect(blank?.dashboardId).toBeNull();
    expect(paneActive(healed, "p2")).toBe(blank?.id);
    expect(healed.windows[0].focusedPaneId).toBe("p1");
    expect(paneActive(healed, "p1")).toBe("t1");
  });

  it("repoints an invalid activeTabId at the pane's most recently active tab", () => {
    const s = snap();
    const broken: TabsSnapshot = {
      ...s,
      panes: s.panes.map((p) => ({ ...p, activeTabId: "gone" })),
      tabs: [
        tab("a", "w1", "p1", { lastActiveAt: 5 }),
        tab("b", "w1", "p1", { lastActiveAt: 9 }),
      ],
    };
    const healed = ensureSnapshotIntegrity(broken, { makeId, now });
    expect(paneActive(healed, "p1")).toBe("b");
  });

  it("repoints an invalid focusedPaneId at the window's first leaf", () => {
    const s = snap([{ id: "w1", panes: ["p1"] }]);
    const broken: TabsSnapshot = {
      ...s,
      windows: s.windows.map((w) => ({ ...w, focusedPaneId: "p-nope" })),
      panes: s.panes.map((p) => ({ ...p, activeTabId: "t1" })),
      tabs: [tab("t1", "w1", "p1")],
    };
    const healed = ensureSnapshotIntegrity(broken, { makeId, now });
    expect(healed.windows[0].focusedPaneId).toBe("p1");
  });

  it("returns the identical snapshot reference when nothing needs fixing", () => {
    const s = snap();
    const valid: TabsSnapshot = {
      ...s,
      panes: s.panes.map((p) => ({ ...p, activeTabId: "t1" })),
      tabs: [tab("t1", "w1", "p1")],
    };
    expect(ensureSnapshotIntegrity(valid, { makeId, now })).toBe(valid);
  });
});

describe("setPaneActiveTab (pane focus interplay)", () => {
  it("focusing a tab in an unfocused pane moves window focus there", () => {
    const s0 = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    const a = open(s0, "p1", "dash-a");
    const x = open(a.snapshot, "p2", "dash-x"); // window focus: p2
    const next = setPaneActiveTab(x.snapshot, "p1", a.tabId);
    expect(focusedPaneIdOf(next)).toBe("p1");
    expect(paneActive(next, "p2")).toBe(x.tabId); // other pane keeps its tab
  });
});
