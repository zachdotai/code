import { describe, expect, it } from "vitest";
import {
  activeTabIsBlank,
  BLANK_PANE_IDENTITY,
  closePane,
  closeTab,
  closeTabs,
  decidePaneNavigation,
  ensureSnapshotIntegrity,
  focusedPaneOfTab,
  mergeTabIntoTab,
  newBlankTab,
  openOrFocusTab,
  type PaneIdentity,
  POSITION_GAP,
  primaryWindowHasNoTabs,
  setFocusedPane,
  setPaneSizes,
  setPaneTarget,
  setTabOrder,
  setWindowActiveTab,
  tabPanes,
} from "./browser-tabs";
import type {
  BrowserPane,
  BrowserTab,
  BrowserWindow,
  PaneLayoutNode,
  TabsSnapshot,
} from "./browser-tabs-schemas";

const NOW = 1_700_000_000_000;
const now = () => NOW;

/** Deterministic id factory: minted-1, minted-2, … per call site. */
function idFactory(prefix = "minted") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const identity = (over: Partial<PaneIdentity> = {}): PaneIdentity => ({
  ...BLANK_PANE_IDENTITY,
  ...over,
});

function win(id: string, over: Partial<BrowserWindow> = {}): BrowserWindow {
  return { id, isPrimary: false, bounds: null, activeTabId: null, ...over };
}

function pane(
  id: string,
  tabId: string,
  windowId: string,
  over: Partial<BrowserPane> = {},
): BrowserPane {
  return {
    id,
    tabId,
    windowId,
    ...BLANK_PANE_IDENTITY,
    scrollState: null,
    createdAt: NOW,
    lastActiveAt: NOW,
    ...over,
  };
}

function tab(
  id: string,
  windowId: string,
  position: number,
  over: Partial<BrowserTab> = {},
): BrowserTab {
  return {
    id,
    windowId,
    layout: { type: "leaf", paneId: `${id}-pane` },
    focusedPaneId: `${id}-pane`,
    position,
    createdAt: NOW,
    lastActiveAt: NOW,
    ...over,
  };
}

/**
 * A primary window with two single-pane tabs: t1 (pane t1-pane, showing
 * dashboard d1) active, and t2 (pane t2-pane, showing task k1).
 */
function baseSnapshot(): TabsSnapshot {
  return {
    windows: [win("w1", { isPrimary: true, activeTabId: "t1" })],
    tabs: [tab("t1", "w1", 1000), tab("t2", "w1", 2000)],
    panes: [
      pane("t1-pane", "t1", "w1", { dashboardId: "d1" }),
      pane("t2-pane", "t2", "w1", { taskId: "k1" }),
    ],
  };
}

function activeTabId(s: TabsSnapshot, windowId = "w1"): string | null {
  const w = s.windows.find((x) => x.id === windowId);
  return w ? w.activeTabId : null;
}

const split = (
  direction: "row" | "column",
  children: PaneLayoutNode[],
  sizes?: number[],
): PaneLayoutNode => ({
  type: "split",
  direction,
  children,
  sizes: sizes ?? children.map(() => 1 / children.length),
});

const leaf = (paneId: string): PaneLayoutNode => ({ type: "leaf", paneId });

describe("openOrFocusTab", () => {
  it("focuses the tab whose pane already shows the identity", () => {
    const result = openOrFocusTab(baseSnapshot(), {
      windowId: "w1",
      ...identity({ taskId: "k1" }),
      makeId: idFactory(),
      now,
    });
    expect(result.opened).toBe(false);
    expect(result.tabId).toBe("t2");
    expect(result.paneId).toBe("t2-pane");
    expect(activeTabId(result.snapshot)).toBe("t2");
    expect(result.snapshot.tabs).toHaveLength(2);
  });

  it("focuses the pane within a multi-pane tab on dedup", () => {
    let s = baseSnapshot();
    // t1 owns two panes; the deduped one is NOT currently focused.
    s = {
      ...s,
      tabs: s.tabs.map((t) =>
        t.id === "t1"
          ? {
              ...t,
              layout: split("row", [leaf("t1-pane"), leaf("extra")]),
              focusedPaneId: "t1-pane",
            }
          : t,
      ),
      panes: [...s.panes, pane("extra", "t1", "w1", { taskId: "k9" })],
    };
    const result = openOrFocusTab(s, {
      windowId: "w1",
      ...identity({ taskId: "k9" }),
      makeId: idFactory(),
      now,
    });
    expect(result.opened).toBe(false);
    expect(result.tabId).toBe("t1");
    expect(result.paneId).toBe("extra");
    const t1 = result.snapshot.tabs.find((t) => t.id === "t1");
    expect(t1?.focusedPaneId).toBe("extra");
  });

  it("appends a new single-pane tab when the identity is not open", () => {
    const result = openOrFocusTab(baseSnapshot(), {
      windowId: "w1",
      ...identity({ dashboardId: "d2" }),
      makeId: idFactory(),
      now,
    });
    expect(result.opened).toBe(true);
    const created = result.snapshot.tabs.find((t) => t.id === result.tabId);
    expect(created).toBeDefined();
    expect(created?.layout).toEqual(leaf(result.paneId));
    expect(created?.focusedPaneId).toBe(result.paneId);
    expect(created?.position).toBe(2000 + POSITION_GAP);
    const createdPane = result.snapshot.panes.find(
      (p) => p.id === result.paneId,
    );
    expect(createdPane?.dashboardId).toBe("d2");
    expect(createdPane?.tabId).toBe(result.tabId);
    expect(activeTabId(result.snapshot)).toBe(result.tabId);
  });

  it("honours renderer-minted tab and pane ids", () => {
    const result = openOrFocusTab(baseSnapshot(), {
      windowId: "w1",
      ...identity({ dashboardId: "d2" }),
      tabId: "my-tab",
      paneId: "my-pane",
      makeId: idFactory(),
      now,
    });
    expect(result.tabId).toBe("my-tab");
    expect(result.paneId).toBe("my-pane");
  });

  it("allows the same identity in another window", () => {
    let s = baseSnapshot();
    s = { ...s, windows: [...s.windows, win("w2")] };
    const result = openOrFocusTab(s, {
      windowId: "w2",
      ...identity({ taskId: "k1" }),
      makeId: idFactory(),
      now,
    });
    expect(result.opened).toBe(true);
    expect(result.snapshot.tabs).toHaveLength(3);
  });
});

describe("newBlankTab", () => {
  it("appends a focused blank single-pane tab", () => {
    const result = newBlankTab(baseSnapshot(), {
      windowId: "w1",
      makeId: idFactory(),
      now,
    });
    expect(result.opened).toBe(true);
    const created = result.snapshot.panes.find((p) => p.id === result.paneId);
    expect(created?.dashboardId).toBeNull();
    expect(created?.taskId).toBeNull();
    expect(activeTabId(result.snapshot)).toBe(result.tabId);
  });
});

describe("setPaneTarget", () => {
  it("points the pane at the identity and focuses pane, tab, and window", () => {
    let s = baseSnapshot();
    s = setWindowActiveTab(s, "w1", "t2");
    const next = setPaneTarget(s, {
      paneId: "t1-pane",
      ...identity({ channelId: "c1", channelSection: "artifacts" }),
      now: () => NOW + 5,
    });
    const p = next.panes.find((x) => x.id === "t1-pane");
    expect(p?.channelId).toBe("c1");
    expect(p?.channelSection).toBe("artifacts");
    expect(p?.dashboardId).toBeNull();
    expect(p?.lastActiveAt).toBe(NOW + 5);
    expect(activeTabId(next)).toBe("t1");
    expect(next.tabs.find((t) => t.id === "t1")?.focusedPaneId).toBe("t1-pane");
  });

  it("is a no-op for an unknown pane", () => {
    const s = baseSnapshot();
    expect(setPaneTarget(s, { paneId: "nope", ...identity(), now })).toBe(s);
  });
});

describe("setWindowActiveTab", () => {
  it("activates a tab in its window", () => {
    const next = setWindowActiveTab(baseSnapshot(), "w1", "t2");
    expect(activeTabId(next)).toBe("t2");
  });

  it("ignores a tab id that no longer exists (stale replay)", () => {
    const s = baseSnapshot();
    expect(setWindowActiveTab(s, "w1", "ghost")).toBe(s);
  });

  it("ignores a tab that lives in another window", () => {
    let s = baseSnapshot();
    s = {
      ...s,
      windows: [...s.windows, win("w2")],
      tabs: [...s.tabs, tab("t3", "w2", 1000)],
      panes: [...s.panes, pane("t3-pane", "t3", "w2")],
    };
    expect(setWindowActiveTab(s, "w1", "t3")).toBe(s);
  });

  it("clears focus with null", () => {
    const next = setWindowActiveTab(baseSnapshot(), "w1", null);
    expect(activeTabId(next)).toBeNull();
  });
});

describe("setFocusedPane", () => {
  const multiPane = (): TabsSnapshot => {
    const s = baseSnapshot();
    return {
      ...s,
      tabs: s.tabs.map((t) =>
        t.id === "t1"
          ? {
              ...t,
              layout: split("row", [leaf("t1-pane"), leaf("extra")]),
            }
          : t,
      ),
      panes: [...s.panes, pane("extra", "t1", "w1")],
    };
  };

  it("focuses a pane of the tab", () => {
    const next = setFocusedPane(multiPane(), "t1", "extra");
    expect(next.tabs.find((t) => t.id === "t1")?.focusedPaneId).toBe("extra");
  });

  it("is a no-op when the pane belongs to another tab", () => {
    const s = multiPane();
    expect(setFocusedPane(s, "t1", "t2-pane")).toBe(s);
  });

  it("is a no-op when already focused", () => {
    const s = multiPane();
    expect(setFocusedPane(s, "t1", "t1-pane")).toBe(s);
  });
});

describe("closeTab", () => {
  const deps = () => ({ makeId: idFactory(), now });

  it("removes the tab and its panes, focusing the neighbour", () => {
    const { snapshot, nextActiveTabId } = closeTab(
      baseSnapshot(),
      "t1",
      deps(),
    );
    expect(snapshot.tabs.map((t) => t.id)).toEqual(["t2"]);
    expect(snapshot.panes.map((p) => p.id)).toEqual(["t2-pane"]);
    expect(nextActiveTabId).toBe("t2");
    expect(activeTabId(snapshot)).toBe("t2");
  });

  it("keeps the active tab when closing an inactive one", () => {
    const { snapshot, nextActiveTabId } = closeTab(
      baseSnapshot(),
      "t2",
      deps(),
    );
    expect(nextActiveTabId).toBe("t1");
    expect(activeTabId(snapshot)).toBe("t1");
  });

  it("removes every pane of a multi-pane tab", () => {
    let s = baseSnapshot();
    s = {
      ...s,
      tabs: s.tabs.map((t) =>
        t.id === "t1"
          ? { ...t, layout: split("row", [leaf("t1-pane"), leaf("extra")]) }
          : t,
      ),
      panes: [...s.panes, pane("extra", "t1", "w1")],
    };
    const { snapshot } = closeTab(s, "t1", deps());
    expect(snapshot.panes.map((p) => p.id)).toEqual(["t2-pane"]);
  });

  it("backfills a blank tab when closing the primary window's last tab", () => {
    let s = baseSnapshot();
    s = closeTab(s, "t2", deps()).snapshot;
    const result = closeTab(s, "t1", {
      makeId: idFactory(),
      now,
      blankTabId: "blank-tab",
      blankPaneId: "blank-pane",
    });
    expect(result.snapshot.tabs.map((t) => t.id)).toEqual(["blank-tab"]);
    expect(result.snapshot.panes.map((p) => p.id)).toEqual(["blank-pane"]);
    expect(result.nextActiveTabId).toBe("blank-tab");
    expect(activeTabId(result.snapshot)).toBe("blank-tab");
    expect(activeTabIsBlank(result.snapshot)).toBe(true);
  });

  it("closes a secondary window with its last tab", () => {
    let s = baseSnapshot();
    s = {
      ...s,
      windows: [...s.windows, win("w2", { activeTabId: "t3" })],
      tabs: [...s.tabs, tab("t3", "w2", 1000)],
      panes: [...s.panes, pane("t3-pane", "t3", "w2")],
    };
    const result = closeTab(s, "t3", deps());
    expect(result.closedWindowId).toBe("w2");
    expect(result.snapshot.windows.map((w) => w.id)).toEqual(["w1"]);
    expect(result.snapshot.tabs.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("is a no-op for an unknown tab", () => {
    const s = baseSnapshot();
    expect(closeTab(s, "ghost", deps()).snapshot).toBe(s);
  });
});

describe("closeTabs", () => {
  it("closes in bulk and focuses the anchor when the active tab died", () => {
    let s = baseSnapshot();
    s = {
      ...s,
      tabs: [...s.tabs, tab("t3", "w1", 3000)],
      panes: [...s.panes, pane("t3-pane", "t3", "w1")],
    };
    const next = closeTabs(s, ["t1", "t2"], "t3", {
      makeId: idFactory(),
      now,
    });
    expect(next.tabs.map((t) => t.id)).toEqual(["t3"]);
    expect(activeTabId(next)).toBe("t3");
  });

  it("returns the snapshot for an empty id list", () => {
    const s = baseSnapshot();
    expect(closeTabs(s, [], null, { makeId: idFactory(), now })).toBe(s);
  });
});

describe("closePane", () => {
  const withSplit = (): TabsSnapshot => {
    const s = baseSnapshot();
    return {
      ...s,
      tabs: s.tabs.map((t) =>
        t.id === "t1"
          ? {
              ...t,
              layout: split("row", [leaf("t1-pane"), leaf("extra")]),
              focusedPaneId: "extra",
            }
          : t,
      ),
      panes: [...s.panes, pane("extra", "t1", "w1", { taskId: "k9" })],
    };
  };

  it("removes the pane, collapses the layout, and refocuses", () => {
    const next = closePane(withSplit(), "t1", "extra");
    const t1 = next.tabs.find((t) => t.id === "t1");
    expect(t1?.layout).toEqual(leaf("t1-pane"));
    expect(t1?.focusedPaneId).toBe("t1-pane");
    expect(next.panes.some((p) => p.id === "extra")).toBe(false);
  });

  it("keeps focus when a non-focused pane closes", () => {
    const next = closePane(withSplit(), "t1", "t1-pane");
    const t1 = next.tabs.find((t) => t.id === "t1");
    expect(t1?.layout).toEqual(leaf("extra"));
    expect(t1?.focusedPaneId).toBe("extra");
  });

  it("is a no-op on a tab's only pane", () => {
    const s = baseSnapshot();
    expect(closePane(s, "t2", "t2-pane")).toBe(s);
  });

  it("is a no-op when the pane belongs to another tab", () => {
    const s = withSplit();
    expect(closePane(s, "t1", "t2-pane")).toBe(s);
  });
});

describe("mergeTabIntoTab", () => {
  it("splices the source pane next to the target pane and drops the source pill", () => {
    const next = mergeTabIntoTab(baseSnapshot(), {
      windowId: "w1",
      sourceTabId: "t2",
      targetTabId: "t1",
      targetPaneId: "t1-pane",
      direction: "right",
      now,
    });
    expect(next.tabs.map((t) => t.id)).toEqual(["t1"]);
    const t1 = next.tabs[0];
    expect(t1.layout).toEqual(
      split("row", [leaf("t1-pane"), leaf("t2-pane")], [0.5, 0.5]),
    );
    expect(t1.focusedPaneId).toBe("t2-pane");
    expect(next.panes.find((p) => p.id === "t2-pane")?.tabId).toBe("t1");
    expect(activeTabId(next)).toBe("t1");
  });

  it("targets the layout root when targetPaneId is null", () => {
    const next = mergeTabIntoTab(baseSnapshot(), {
      windowId: "w1",
      sourceTabId: "t2",
      targetTabId: "t1",
      targetPaneId: null,
      direction: "bottom",
      now,
    });
    expect(next.tabs[0].layout).toEqual(
      split("column", [leaf("t1-pane"), leaf("t2-pane")], [0.5, 0.5]),
    );
  });

  it("merges a multi-pane source, flattening same-axis nesting", () => {
    let s = baseSnapshot();
    s = {
      ...s,
      tabs: s.tabs.map((t) =>
        t.id === "t2"
          ? {
              ...t,
              layout: split("row", [leaf("t2-pane"), leaf("t2-b")]),
              focusedPaneId: "t2-b",
            }
          : t,
      ),
      panes: [...s.panes, pane("t2-b", "t2", "w1")],
    };
    const next = mergeTabIntoTab(s, {
      windowId: "w1",
      sourceTabId: "t2",
      targetTabId: "t1",
      targetPaneId: "t1-pane",
      direction: "right",
      now,
    });
    const t1 = next.tabs[0];
    expect(t1.layout.type).toBe("split");
    if (t1.layout.type === "split") {
      expect(t1.layout.direction).toBe("row");
      expect(t1.layout.children.every((c) => c.type === "leaf")).toBe(true);
      expect(t1.layout.children).toHaveLength(3);
    }
    expect(t1.focusedPaneId).toBe("t2-b");
    expect(next.panes.every((p) => p.tabId === "t1")).toBe(true);
  });

  it.each([
    ["source === target", { sourceTabId: "t1", targetTabId: "t1" }],
    ["an unknown source", { sourceTabId: "ghost", targetTabId: "t1" }],
    [
      "a target pane outside the target tab",
      { sourceTabId: "t2", targetTabId: "t1", targetPaneId: "t2-pane" },
    ],
  ] as const)("is a no-op for %s", (_name, over) => {
    const s = baseSnapshot();
    const next = mergeTabIntoTab(s, {
      windowId: "w1",
      targetPaneId: "t1-pane",
      direction: "right",
      now,
      ...over,
    });
    expect(next).toBe(s);
  });

  it("is a no-op across windows", () => {
    let s = baseSnapshot();
    s = {
      ...s,
      windows: [...s.windows, win("w2")],
      tabs: [...s.tabs, tab("t3", "w2", 1000)],
      panes: [...s.panes, pane("t3-pane", "t3", "w2")],
    };
    expect(
      mergeTabIntoTab(s, {
        windowId: "w1",
        sourceTabId: "t3",
        targetTabId: "t1",
        targetPaneId: null,
        direction: "right",
        now,
      }),
    ).toBe(s);
  });
});

describe("setTabOrder", () => {
  it("applies the given order with gap-spaced positions", () => {
    const next = setTabOrder(baseSnapshot(), "w1", ["t2", "t1"]);
    const positions = new Map(next.tabs.map((t) => [t.id, t.position]));
    expect(positions.get("t2")).toBe(POSITION_GAP);
    expect(positions.get("t1")).toBe(2 * POSITION_GAP);
  });

  it("keeps object identity for tabs whose position is unchanged", () => {
    const s = baseSnapshot();
    const next = setTabOrder(s, "w1", ["t1", "t2"]);
    expect(next).toBe(s);
  });

  it("appends unlisted tabs after the listed ones in their old order", () => {
    let s = baseSnapshot();
    s = {
      ...s,
      tabs: [...s.tabs, tab("t3", "w1", 3000)],
      panes: [...s.panes, pane("t3-pane", "t3", "w1")],
    };
    const next = setTabOrder(s, "w1", ["t3"]);
    const ordered = next.tabs
      .filter((t) => t.windowId === "w1")
      .sort((a, b) => a.position - b.position)
      .map((t) => t.id);
    expect(ordered).toEqual(["t3", "t1", "t2"]);
  });
});

describe("setPaneSizes", () => {
  it("updates the addressed split in the tab's layout", () => {
    let s = baseSnapshot();
    s = {
      ...s,
      tabs: s.tabs.map((t) =>
        t.id === "t1"
          ? { ...t, layout: split("row", [leaf("t1-pane"), leaf("extra")]) }
          : t,
      ),
      panes: [...s.panes, pane("extra", "t1", "w1")],
    };
    const next = setPaneSizes(s, "t1", [], [3, 1]);
    const layout = next.tabs.find((t) => t.id === "t1")?.layout;
    expect(layout?.type).toBe("split");
    if (layout?.type === "split") {
      expect(layout.sizes[0]).toBeCloseTo(0.75, 10);
    }
  });

  it("is a no-op for an unknown tab or invalid sizes", () => {
    const s = baseSnapshot();
    expect(setPaneSizes(s, "ghost", [], [1, 1])).toBe(s);
    expect(setPaneSizes(s, "t1", [], [1, 1])).toBe(s); // leaf layout
  });
});

describe("helpers", () => {
  it("tabPanes returns panes in layout order", () => {
    let s = baseSnapshot();
    s = {
      ...s,
      tabs: s.tabs.map((t) =>
        t.id === "t1"
          ? { ...t, layout: split("row", [leaf("extra"), leaf("t1-pane")]) }
          : t,
      ),
      panes: [...s.panes, pane("extra", "t1", "w1")],
    };
    expect(tabPanes(s, "t1").map((p) => p.id)).toEqual(["extra", "t1-pane"]);
  });

  it("focusedPaneOfTab resolves the focused pane", () => {
    const s = baseSnapshot();
    const t1 = s.tabs[0];
    expect(focusedPaneOfTab(s, t1)?.id).toBe("t1-pane");
  });

  it("activeTabIsBlank is false for a tab showing content", () => {
    expect(activeTabIsBlank(baseSnapshot())).toBe(false);
  });

  it("activeTabIsBlank is true when the focused pane is blank", () => {
    const result = newBlankTab(baseSnapshot(), {
      windowId: "w1",
      makeId: idFactory(),
      now,
    });
    expect(activeTabIsBlank(result.snapshot)).toBe(true);
  });

  it("primaryWindowHasNoTabs reflects an empty window", () => {
    const s = baseSnapshot();
    expect(primaryWindowHasNoTabs(s)).toBe(false);
    expect(primaryWindowHasNoTabs({ ...s, tabs: [], panes: [] })).toBe(true);
  });
});

describe("ensureSnapshotIntegrity", () => {
  const deps = () => ({ makeId: idFactory(), now });

  it("returns the same reference for a canonical snapshot", () => {
    const s = baseSnapshot();
    expect(ensureSnapshotIntegrity(s, deps())).toBe(s);
  });

  it("creates a primary window (with a blank tab) from an empty snapshot", () => {
    const next = ensureSnapshotIntegrity(
      { windows: [], tabs: [], panes: [] },
      deps(),
    );
    expect(next.windows).toHaveLength(1);
    expect(next.windows[0].isPrimary).toBe(true);
    expect(next.tabs).toHaveLength(1);
    expect(next.panes).toHaveLength(1);
    expect(next.windows[0].activeTabId).toBe(next.tabs[0].id);
  });

  it("promotes the first window when none is primary", () => {
    const s = baseSnapshot();
    const next = ensureSnapshotIntegrity(
      {
        ...s,
        windows: s.windows.map((w) => ({ ...w, isPrimary: false })),
      },
      deps(),
    );
    expect(next.windows[0].isPrimary).toBe(true);
  });

  it("moves a tab in a dead window to the primary", () => {
    const s = baseSnapshot();
    const broken: TabsSnapshot = {
      ...s,
      tabs: [...s.tabs, tab("t3", "ghost-window", 1000)],
      panes: [...s.panes, pane("t3-pane", "t3", "ghost-window")],
    };
    const next = ensureSnapshotIntegrity(broken, deps());
    const t3 = next.tabs.find((t) => t.id === "t3");
    expect(t3?.windowId).toBe("w1");
    expect(next.panes.find((p) => p.id === "t3-pane")?.windowId).toBe("w1");
  });

  it("drops a pane whose tab does not exist", () => {
    const s = baseSnapshot();
    const broken: TabsSnapshot = {
      ...s,
      panes: [...s.panes, pane("orphan", "ghost-tab", "w1")],
    };
    const next = ensureSnapshotIntegrity(broken, deps());
    expect(next.panes.some((p) => p.id === "orphan")).toBe(false);
  });

  it("prunes layout leaves without a pane row", () => {
    const s = baseSnapshot();
    const broken: TabsSnapshot = {
      ...s,
      tabs: s.tabs.map((t) =>
        t.id === "t1"
          ? { ...t, layout: split("row", [leaf("t1-pane"), leaf("ghost")]) }
          : t,
      ),
    };
    const next = ensureSnapshotIntegrity(broken, deps());
    expect(next.tabs.find((t) => t.id === "t1")?.layout).toEqual(
      leaf("t1-pane"),
    );
  });

  it("grafts a pane row missing from its tab's layout", () => {
    const s = baseSnapshot();
    const broken: TabsSnapshot = {
      ...s,
      panes: [...s.panes, pane("lost", "t1", "w1", { taskId: "k5" })],
    };
    const next = ensureSnapshotIntegrity(broken, deps());
    const t1 = next.tabs.find((t) => t.id === "t1");
    expect(t1?.layout).toEqual(
      split("row", [leaf("t1-pane"), leaf("lost")], [0.5, 0.5]),
    );
  });

  it("synthesizes a blank pane for a paneless tab", () => {
    const s = baseSnapshot();
    const broken: TabsSnapshot = {
      ...s,
      panes: s.panes.filter((p) => p.tabId !== "t1"),
    };
    const next = ensureSnapshotIntegrity(broken, deps());
    const t1 = next.tabs.find((t) => t.id === "t1");
    expect(t1).toBeDefined();
    const t1Panes = next.panes.filter((p) => p.tabId === "t1");
    expect(t1Panes).toHaveLength(1);
    expect(t1?.layout).toEqual(leaf(t1Panes[0].id));
    expect(t1?.focusedPaneId).toBe(t1Panes[0].id);
  });

  it("heals an invalid focusedPaneId to the first leaf", () => {
    const s = baseSnapshot();
    const broken: TabsSnapshot = {
      ...s,
      tabs: s.tabs.map((t) =>
        t.id === "t1" ? { ...t, focusedPaneId: "ghost" } : t,
      ),
    };
    const next = ensureSnapshotIntegrity(broken, deps());
    expect(next.tabs.find((t) => t.id === "t1")?.focusedPaneId).toBe("t1-pane");
  });

  it("drops an empty secondary window and backfills an empty primary", () => {
    const s = baseSnapshot();
    const broken: TabsSnapshot = {
      windows: [...s.windows, win("w2")],
      tabs: [],
      panes: [],
    };
    const next = ensureSnapshotIntegrity(broken, deps());
    expect(next.windows.map((w) => w.id)).toEqual(["w1"]);
    expect(next.tabs).toHaveLength(1);
    expect(next.windows[0].activeTabId).toBe(next.tabs[0].id);
  });

  it("heals a dangling activeTabId to the most recently active tab", () => {
    const s = baseSnapshot();
    const broken: TabsSnapshot = {
      ...s,
      windows: s.windows.map((w) => ({ ...w, activeTabId: "ghost" })),
      tabs: s.tabs.map((t) =>
        t.id === "t2" ? { ...t, lastActiveAt: NOW + 10 } : t,
      ),
    };
    const next = ensureSnapshotIntegrity(broken, deps());
    expect(next.windows[0].activeTabId).toBe("t2");
  });

  it("reindexes colliding tab positions stably", () => {
    const s = baseSnapshot();
    const broken: TabsSnapshot = {
      ...s,
      tabs: s.tabs.map((t) => ({ ...t, position: 1000 })),
    };
    const next = ensureSnapshotIntegrity(broken, deps());
    const positions = next.tabs.map((t) => t.position);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe("decidePaneNavigation", () => {
  const d1 = identity({ dashboardId: "d1" });
  const k1 = identity({ taskId: "k1" });

  it("noops on a blank route", () => {
    expect(
      decidePaneNavigation({
        paneIdentity: d1,
        routeIdentity: identity(),
        otherOpenPanes: [],
        historyAction: "PUSH",
      }),
    ).toEqual({ type: "noop" });
  });

  it("noops when the pane already shows the route", () => {
    expect(
      decidePaneNavigation({
        paneIdentity: d1,
        routeIdentity: d1,
        otherOpenPanes: [],
        historyAction: "PUSH",
      }),
    ).toEqual({ type: "noop" });
  });

  it("activates the tab of another pane already showing the route on PUSH", () => {
    expect(
      decidePaneNavigation({
        paneIdentity: d1,
        routeIdentity: k1,
        otherOpenPanes: [{ tabId: "t2", paneId: "t2-pane", identity: k1 }],
        historyAction: "PUSH",
      }),
    ).toEqual({ type: "activateTab", tabId: "t2", paneId: "t2-pane" });
  });

  it.each(["BACK", "FORWARD", "GO", "REPLACE", null] as const)(
    "replaces in place on %s even when another pane matches",
    (historyAction) => {
      expect(
        decidePaneNavigation({
          paneIdentity: d1,
          routeIdentity: k1,
          otherOpenPanes: [{ tabId: "t2", paneId: "t2-pane", identity: k1 }],
          historyAction,
        }),
      ).toEqual({ type: "replacePane" });
    },
  );

  it("fills a blank pane instead of deduping away from it", () => {
    expect(
      decidePaneNavigation({
        paneIdentity: identity(),
        routeIdentity: k1,
        otherOpenPanes: [{ tabId: "t2", paneId: "t2-pane", identity: k1 }],
        historyAction: "PUSH",
      }),
    ).toEqual({ type: "replacePane" });
  });

  it("replaces in place for an ordinary navigation", () => {
    expect(
      decidePaneNavigation({
        paneIdentity: d1,
        routeIdentity: k1,
        otherOpenPanes: [],
        historyAction: "PUSH",
      }),
    ).toEqual({ type: "replacePane" });
  });
});
