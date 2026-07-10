import { describe, expect, it } from "vitest";
import {
  activeTabIsBlank,
  closeTab,
  closeTabs,
  decideTabNavigation,
  newBlankTab,
  openOrFocusTab,
  POSITION_GAP,
  paneTabs,
  primaryWindow,
  setPaneActiveTab,
  setTabOrder,
  setTabTarget,
} from "./browser-tabs";
import type {
  BrowserPane,
  PaneLayoutNode,
  TabsSnapshot,
} from "./browser-tabs-schemas";

let idCounter = 0;
const makeId = () => `tab-${++idCounter}`;
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

function paneActive(s: TabsSnapshot, paneId: string): string | null {
  return s.panes.find((p) => p.id === paneId)?.activeTabId ?? null;
}

function focusedPaneIdOf(s: TabsSnapshot, windowId = "w1"): string | undefined {
  return s.windows.find((w) => w.id === windowId)?.focusedPaneId;
}

function open(
  s: TabsSnapshot,
  paneId: string,
  dashboardId: string,
  channelId: string | null = "c1",
) {
  return openOrFocusTab(s, {
    paneId,
    dashboardId,
    taskId: null,
    channelId,
    makeId,
    now,
  });
}

describe("openOrFocusTab", () => {
  it("opens a new tab and makes it the pane's active tab", () => {
    const r = open(snap(), "p1", "dash-a");
    expect(r.opened).toBe(true);
    expect(r.snapshot.tabs).toHaveLength(1);
    expect(paneActive(r.snapshot, "p1")).toBe(r.tabId);
    expect(r.snapshot.tabs[0].position).toBe(POSITION_GAP);
    expect(r.snapshot.tabs[0].paneId).toBe("p1");
    expect(r.snapshot.tabs[0].windowId).toBe("w1");
  });

  it("dedups within a pane: focuses the existing tab instead of opening", () => {
    const first = open(snap(), "p1", "dash-a");
    const second = open(first.snapshot, "p1", "dash-a");
    expect(second.opened).toBe(false);
    expect(second.tabId).toBe(first.tabId);
    expect(second.snapshot.tabs).toHaveLength(1);
  });

  it("allows the same canvas in two different windows", () => {
    const twoWindows = snap([
      { id: "w1", panes: ["p1"] },
      { id: "w2", isPrimary: false, panes: ["p2"] },
    ]);
    const a = open(twoWindows, "p1", "dash-a");
    const b = open(a.snapshot, "p2", "dash-a");
    expect(b.opened).toBe(true);
    expect(b.snapshot.tabs).toHaveLength(2);
  });

  it("allows the same canvas in two panes of one window (dedup is per pane)", () => {
    const s = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    const a = open(s, "p1", "dash-a");
    const b = open(a.snapshot, "p2", "dash-a");
    expect(b.opened).toBe(true);
    expect(b.snapshot.tabs).toHaveLength(2);
  });

  it("treats a channel's sections as distinct tabs but dedups the same one", () => {
    const history = openOrFocusTab(snap(), {
      paneId: "p1",
      dashboardId: null,
      taskId: null,
      channelId: "c1",
      channelSection: "history",
      makeId,
      now,
    });
    const artifacts = openOrFocusTab(history.snapshot, {
      paneId: "p1",
      dashboardId: null,
      taskId: null,
      channelId: "c1",
      channelSection: "artifacts",
      makeId,
      now,
    });
    expect(artifacts.opened).toBe(true);
    expect(artifacts.snapshot.tabs).toHaveLength(2);
    const historyAgain = openOrFocusTab(artifacts.snapshot, {
      paneId: "p1",
      dashboardId: null,
      taskId: null,
      channelId: "c1",
      channelSection: "history",
      makeId,
      now,
    });
    expect(historyAgain.opened).toBe(false);
    expect(historyAgain.tabId).toBe(history.tabId);
  });

  it("appends new tabs after existing ones", () => {
    const a = open(snap(), "p1", "dash-a");
    const b = open(a.snapshot, "p1", "dash-b");
    const positions = b.snapshot.tabs
      .map((t) => t.position)
      .sort((x, y) => x - y);
    expect(positions).toEqual([POSITION_GAP, POSITION_GAP * 2]);
  });

  it("focuses the tab's pane in its window", () => {
    const s = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    const r = open(s, "p2", "dash-a");
    expect(focusedPaneIdOf(r.snapshot)).toBe("p2");
  });
});

describe("closeTab", () => {
  it("focuses the neighbouring tab when the active tab closes", () => {
    const a = open(snap(), "p1", "dash-a");
    const b = open(a.snapshot, "p1", "dash-b");
    const r = closeTab(b.snapshot, b.tabId, { makeId, now });
    expect(r.snapshot.tabs).toHaveLength(1);
    expect(r.nextActiveTabId).toBe(a.tabId);
    expect(paneActive(r.snapshot, "p1")).toBe(a.tabId);
  });

  it("closes a single-pane secondary window when its last tab closes", () => {
    const s = snap([
      { id: "w1", panes: ["p1"] },
      { id: "w2", isPrimary: false, panes: ["p2"] },
    ]);
    const t = open(s, "p2", "dash-a");
    const r = closeTab(t.snapshot, t.tabId, { makeId, now });
    expect(r.closedWindowId).toBe("w2");
    expect(r.snapshot.windows.map((w) => w.id)).toEqual(["w1"]);
    expect(r.snapshot.panes.map((p) => p.id)).toEqual(["p1"]);
  });

  it("backfills a blank tab when the primary pane's last tab closes", () => {
    const t = open(snap(), "p1", "dash-a");
    const r = closeTab(t.snapshot, t.tabId, { makeId, now });
    expect(r.closedWindowId).toBeNull();
    expect(r.snapshot.tabs).toHaveLength(1);
    const blank = r.snapshot.tabs[0];
    expect(blank.dashboardId).toBeNull();
    expect(blank.channelId).toBeNull();
    expect(r.nextActiveTabId).toBe(blank.id);
    expect(paneActive(r.snapshot, "p1")).toBe(blank.id);
  });

  it("mints the blank backfill with deps.blankTabId when provided", () => {
    const t = open(snap(), "p1", "dash-a");
    const r = closeTab(t.snapshot, t.tabId, {
      makeId,
      now,
      blankTabId: "blank-9",
    });
    expect(r.snapshot.tabs.map((x) => x.id)).toEqual(["blank-9"]);
    expect(r.nextActiveTabId).toBe("blank-9");
  });

  it("falls back to makeId for the blank backfill without deps.blankTabId", () => {
    const t = open(snap(), "p1", "dash-a");
    const r = closeTab(t.snapshot, t.tabId, { makeId: () => "made-1", now });
    expect(r.snapshot.tabs.map((x) => x.id)).toEqual(["made-1"]);
    expect(r.nextActiveTabId).toBe("made-1");
  });

  it("backfills instead of closing a multi-pane secondary window's pane", () => {
    const s = snap([
      { id: "w1", panes: ["p1"] },
      { id: "w2", isPrimary: false, panes: ["p2", "p3"] },
    ]);
    const a = open(s, "p2", "dash-a");
    const b = open(a.snapshot, "p3", "dash-b");
    const r = closeTab(b.snapshot, a.tabId, { makeId, now });
    expect(r.closedWindowId).toBeNull();
    expect(r.snapshot.windows.map((w) => w.id)).toEqual(["w1", "w2"]);
    const blank = r.snapshot.tabs.find((t) => t.paneId === "p2");
    expect(blank?.dashboardId).toBeNull();
    expect(r.nextActiveTabId).toBe(blank?.id);
  });

  it("is a no-op for an unknown tab id", () => {
    const s = snap();
    const r = closeTab(s, "nope", { makeId, now });
    expect(r.snapshot).toBe(s);
    expect(r.nextActiveTabId).toBeNull();
    expect(r.closedWindowId).toBeNull();
  });
});

describe("newBlankTab", () => {
  it("appends a focused blank tab with no canvas", () => {
    const existing = open(snap(), "p1", "dash-a");
    const r = newBlankTab(existing.snapshot, { paneId: "p1", makeId, now });
    expect(r.snapshot.tabs).toHaveLength(2);
    const blank = r.snapshot.tabs.find((t) => t.id === r.tabId);
    expect(blank?.dashboardId).toBeNull();
    expect(paneActive(r.snapshot, "p1")).toBe(r.tabId);
  });
});

describe("setTabTarget", () => {
  it("points an existing tab at a canvas and focuses it (in-tab nav)", () => {
    const blank = newBlankTab(snap(), { paneId: "p1", makeId, now });
    const next = setTabTarget(blank.snapshot, {
      tabId: blank.tabId,
      dashboardId: "dash-x",
      taskId: null,
      channelId: "c1",
      now,
    });
    const tab = next.tabs.find((t) => t.id === blank.tabId);
    expect(tab?.dashboardId).toBe("dash-x");
    expect(tab?.channelId).toBe("c1");
    expect(next.tabs).toHaveLength(1); // replaced contents, no new tab
    expect(paneActive(next, "p1")).toBe(blank.tabId);
  });

  it("points an existing tab at a task (tasks are first-class targets)", () => {
    const blank = newBlankTab(snap(), { paneId: "p1", makeId, now });
    const next = setTabTarget(blank.snapshot, {
      tabId: blank.tabId,
      dashboardId: null,
      taskId: "task-9",
      channelId: "c1",
      now,
    });
    const tab = next.tabs.find((t) => t.id === blank.tabId);
    expect(tab?.taskId).toBe("task-9");
    expect(tab?.dashboardId).toBeNull();
  });

  it("is a no-op for an unknown tab id", () => {
    const s = snap();
    expect(
      setTabTarget(s, {
        tabId: "nope",
        dashboardId: "d",
        taskId: null,
        channelId: null,
        now,
      }),
    ).toBe(s);
  });
});

describe("decideTabNavigation", () => {
  const base = {
    historyTabId: null as string | null,
    paneActiveTabId: null as string | null,
    activeTab: null as {
      id: string;
      dashboardId: string | null;
      taskId: string | null;
    } | null,
    routeDashboardId: null as string | null,
    routeTaskId: null as string | null,
    routeChannelId: null as string | null,
  };

  it("activates the tagged tab on a switch / back-forward replay", () => {
    expect(
      decideTabNavigation({
        ...base,
        historyTabId: "tab-b",
        paneActiveTabId: "tab-a",
      }),
    ).toEqual({ type: "activate", tabId: "tab-b" });
  });

  it("back to the previous tab activates it (history entry tagged with that tab)", () => {
    // After switching A→B, pressing back lands on A's entry: historyTabId=A
    // while the server still thinks B is active → activate A.
    expect(
      decideTabNavigation({
        ...base,
        historyTabId: "tab-a",
        paneActiveTabId: "tab-b",
      }),
    ).toEqual({ type: "activate", tabId: "tab-a" });
  });

  it("is a noop when the tagged tab is already active", () => {
    expect(
      decideTabNavigation({
        ...base,
        historyTabId: "tab-a",
        paneActiveTabId: "tab-a",
      }),
    ).toEqual({ type: "noop" });
  });

  it("replaces the active tab's canvas on an untagged in-tab nav", () => {
    expect(
      decideTabNavigation({
        ...base,
        paneActiveTabId: "tab-a",
        activeTab: { id: "tab-a", dashboardId: "old", taskId: null },
        routeDashboardId: "new",
        routeChannelId: "c1",
      }),
    ).toEqual({
      type: "replace",
      tabId: "tab-a",
      dashboardId: "new",
      taskId: null,
      channelId: "c1",
      channelSection: null,
      appView: null,
      stampTabId: "tab-a",
    });
  });

  it("replaces even when the entry is tagged with the active tab (inherited tag)", () => {
    // A plain navigate (sidebar) inherits the active tab's tag, so an in-tab nav
    // arrives tagged with the active tab. It must still replace, not noop.
    expect(
      decideTabNavigation({
        ...base,
        historyTabId: "tab-a",
        paneActiveTabId: "tab-a",
        activeTab: { id: "tab-a", dashboardId: "old", taskId: null },
        routeDashboardId: "new",
        routeChannelId: "c1",
      }),
    ).toEqual({
      type: "replace",
      tabId: "tab-a",
      dashboardId: "new",
      taskId: null,
      channelId: "c1",
      channelSection: null,
      appView: null,
      stampTabId: "tab-a",
    });
  });

  it("opens a tab when an untagged canvas nav has no active tab", () => {
    expect(
      decideTabNavigation({
        ...base,
        routeDashboardId: "d1",
        routeChannelId: "c1",
      }),
    ).toEqual({
      type: "open",
      dashboardId: "d1",
      taskId: null,
      channelId: "c1",
      channelSection: null,
      appView: null,
      stampTabId: null,
    });
  });

  it("replaces the active tab when navigating between channel sections", () => {
    // In-tab nav from a channel's history to its artifacts: same tab, new section.
    expect(
      decideTabNavigation({
        ...base,
        paneActiveTabId: "tab-a",
        activeTab: {
          id: "tab-a",
          dashboardId: null,
          taskId: null,
          channelId: "c1",
          channelSection: "history",
        },
        routeChannelId: "c1",
        routeChannelSection: "artifacts",
      }),
    ).toEqual({
      type: "replace",
      tabId: "tab-a",
      dashboardId: null,
      taskId: null,
      channelId: "c1",
      channelSection: "artifacts",
      appView: null,
      stampTabId: "tab-a",
    });
  });

  it("opens a channel-section tab when there is no active tab", () => {
    expect(
      decideTabNavigation({
        ...base,
        routeChannelId: "c1",
        routeChannelSection: "history",
      }),
    ).toEqual({
      type: "open",
      dashboardId: null,
      taskId: null,
      channelId: "c1",
      channelSection: "history",
      appView: null,
      stampTabId: null,
    });
  });

  it("only stamps when the active tab already shows the route channel section", () => {
    expect(
      decideTabNavigation({
        ...base,
        paneActiveTabId: "tab-a",
        activeTab: {
          id: "tab-a",
          dashboardId: null,
          taskId: null,
          channelId: "c1",
          channelSection: "history",
        },
        routeChannelId: "c1",
        routeChannelSection: "history",
      }),
    ).toEqual({ type: "stamp", stampTabId: "tab-a" });
  });

  it("only stamps when the active tab already shows the route canvas", () => {
    expect(
      decideTabNavigation({
        ...base,
        paneActiveTabId: "tab-a",
        activeTab: { id: "tab-a", dashboardId: "same", taskId: null },
        routeDashboardId: "same",
      }),
    ).toEqual({ type: "stamp", stampTabId: "tab-a" });
  });

  it("is a noop on a blank/landing route (no canvas)", () => {
    expect(
      decideTabNavigation({
        ...base,
        paneActiveTabId: "tab-a",
        activeTab: { id: "tab-a", dashboardId: null, taskId: null },
        routeDashboardId: null,
      }),
    ).toEqual({ type: "noop" });
  });
});

describe("decideTabNavigation: dedup against existing tabs (paneTabs)", () => {
  const identity = {
    dashboardId: null,
    taskId: null,
    channelId: null,
    channelSection: null,
    appView: null,
  };

  it("activates the existing tab instead of replacing the active tab's target (would-be duplicate)", () => {
    // A rapid switch whose history stamp was lost arrives looking like an in-tab
    // nav: active tab A, but the route identifies tab B (already open). Without
    // the dedup this replaces A's target → two tabs on c2/artifacts. With it, B
    // is focused.
    expect(
      decideTabNavigation({
        historyTabId: "tab-a",
        paneActiveTabId: "tab-a",
        paneTabs: [
          { id: "tab-a", ...identity, channelId: "c1" },
          {
            id: "tab-b",
            ...identity,
            channelId: "c2",
            channelSection: "artifacts",
          },
        ],
        activeTab: {
          id: "tab-a",
          dashboardId: null,
          taskId: null,
          channelId: "c1",
        },
        routeDashboardId: null,
        routeTaskId: null,
        routeChannelId: "c2",
        routeChannelSection: "artifacts",
      }),
    ).toEqual({ type: "activate", tabId: "tab-b" });
  });

  it("activates an existing matching tab instead of opening a duplicate (no active tab)", () => {
    expect(
      decideTabNavigation({
        historyTabId: null,
        paneActiveTabId: null,
        paneTabs: [{ id: "tab-b", ...identity, channelId: "c2" }],
        activeTab: null,
        routeDashboardId: null,
        routeTaskId: null,
        routeChannelId: "c2",
      }),
    ).toEqual({ type: "activate", tabId: "tab-b" });
  });

  it("does NOT jump when the active tab already shows the route, even if a duplicate exists", () => {
    // Two tabs share an identity (a pre-existing duplicate). The active one
    // already shows the route → stamp/noop. Jumping to the other duplicate
    // would ping-pong between them forever (Maximum update depth exceeded).
    expect(
      decideTabNavigation({
        historyTabId: "tab-x",
        paneActiveTabId: "tab-x",
        paneTabs: [
          {
            id: "tab-x",
            ...identity,
            channelId: "c1",
            channelSection: "artifacts",
          },
          {
            id: "tab-y",
            ...identity,
            channelId: "c1",
            channelSection: "artifacts",
          },
        ],
        activeTab: {
          id: "tab-x",
          dashboardId: null,
          taskId: null,
          channelId: "c1",
          channelSection: "artifacts",
        },
        routeDashboardId: null,
        routeTaskId: null,
        routeChannelId: "c1",
        routeChannelSection: "artifacts",
      }),
    ).toEqual({ type: "stamp", stampTabId: "tab-x" });
  });

  it("fills a blank active tab (fresh + tab) even when the route is open elsewhere", () => {
    // Cmd+T lands the new blank tab on #me. If a #me tab is already open, the
    // dedup must NOT steal the navigation to it — that would strand the blank
    // tab forever. The blank active tab means "fill me".
    expect(
      decideTabNavigation({
        historyTabId: "tab-blank",
        paneActiveTabId: "tab-blank",
        paneTabs: [
          { id: "tab-blank", ...identity },
          { id: "tab-me", ...identity, channelId: "me-ch" },
        ],
        activeTab: { id: "tab-blank", dashboardId: null, taskId: null },
        routeDashboardId: null,
        routeTaskId: null,
        routeChannelId: "me-ch",
      }),
    ).toEqual({
      type: "replace",
      tabId: "tab-blank",
      dashboardId: null,
      taskId: null,
      channelId: "me-ch",
      channelSection: null,
      appView: null,
      stampTabId: "tab-blank",
    });
  });

  it("still replaces for a genuine in-tab nav to a target no other tab holds", () => {
    expect(
      decideTabNavigation({
        historyTabId: "tab-a",
        paneActiveTabId: "tab-a",
        paneTabs: [{ id: "tab-a", ...identity, channelId: "c1" }],
        activeTab: {
          id: "tab-a",
          dashboardId: null,
          taskId: null,
          channelId: "c1",
        },
        routeDashboardId: null,
        routeTaskId: null,
        routeChannelId: "c1",
        routeChannelSection: "artifacts",
      }),
    ).toEqual({
      type: "replace",
      tabId: "tab-a",
      dashboardId: null,
      taskId: null,
      channelId: "c1",
      channelSection: "artifacts",
      appView: null,
      stampTabId: "tab-a",
    });
  });
});

describe("decideTabNavigation: cross-pane dedup (otherPanes → focusPane)", () => {
  const identity = {
    dashboardId: null,
    taskId: null,
    channelId: null,
    channelSection: null,
    appView: null,
  };

  it("focuses the other pane when the route identity is already open there", () => {
    // Untagged nav to c2 while c2 lives in pane p2 → focus that pane, never
    // mount the same identity live in two panes.
    expect(
      decideTabNavigation({
        historyTabId: null,
        paneActiveTabId: "tab-a",
        paneTabs: [{ id: "tab-a", ...identity, channelId: "c1" }],
        otherPanes: [
          {
            paneId: "p2",
            tabs: [{ id: "tab-z", ...identity, channelId: "c2" }],
          },
        ],
        activeTab: {
          id: "tab-a",
          dashboardId: null,
          taskId: null,
          channelId: "c1",
        },
        routeDashboardId: null,
        routeTaskId: null,
        routeChannelId: "c2",
      }),
    ).toEqual({ type: "focusPane", paneId: "p2", tabId: "tab-z" });
  });

  it("prefers a pane-local match over another pane's match", () => {
    expect(
      decideTabNavigation({
        historyTabId: null,
        paneActiveTabId: "tab-a",
        paneTabs: [
          { id: "tab-a", ...identity, channelId: "c1" },
          { id: "tab-local", ...identity, channelId: "c2" },
        ],
        otherPanes: [
          {
            paneId: "p2",
            tabs: [{ id: "tab-z", ...identity, channelId: "c2" }],
          },
        ],
        activeTab: {
          id: "tab-a",
          dashboardId: null,
          taskId: null,
          channelId: "c1",
        },
        routeDashboardId: null,
        routeTaskId: null,
        routeChannelId: "c2",
      }),
    ).toEqual({ type: "activate", tabId: "tab-local" });
  });

  it("a blank active tab absorbs the nav even when the identity is open elsewhere", () => {
    // Blank means "fill me": neither the pane-local nor the cross-pane dedup
    // may steal the navigation.
    expect(
      decideTabNavigation({
        historyTabId: "tab-blank",
        paneActiveTabId: "tab-blank",
        paneTabs: [
          { id: "tab-blank", ...identity },
          { id: "tab-dup", ...identity, channelId: "c2" },
        ],
        otherPanes: [
          {
            paneId: "p2",
            tabs: [{ id: "tab-z", ...identity, channelId: "c2" }],
          },
        ],
        activeTab: { id: "tab-blank", dashboardId: null, taskId: null },
        routeDashboardId: null,
        routeTaskId: null,
        routeChannelId: "c2",
      }),
    ).toEqual({
      type: "replace",
      tabId: "tab-blank",
      dashboardId: null,
      taskId: null,
      channelId: "c2",
      channelSection: null,
      appView: null,
      stampTabId: "tab-blank",
    });
  });

  it("stamps when the active tab already shows the route despite a cross-pane duplicate", () => {
    expect(
      decideTabNavigation({
        historyTabId: null,
        paneActiveTabId: "tab-a",
        paneTabs: [{ id: "tab-a", ...identity, channelId: "c2" }],
        otherPanes: [
          {
            paneId: "p2",
            tabs: [{ id: "tab-z", ...identity, channelId: "c2" }],
          },
        ],
        activeTab: {
          id: "tab-a",
          dashboardId: null,
          taskId: null,
          channelId: "c2",
        },
        routeDashboardId: null,
        routeTaskId: null,
        routeChannelId: "c2",
      }),
    ).toEqual({ type: "stamp", stampTabId: "tab-a" });
  });
});

function openChannel(s: TabsSnapshot, paneId: string, channelId: string) {
  return openOrFocusTab(s, {
    paneId,
    dashboardId: null,
    taskId: null,
    channelId,
    makeId,
    now,
  });
}

describe("activeTabIsBlank", () => {
  it("is true when the active tab has no canvas, task, or channel", () => {
    const t = newBlankTab(snap(), { paneId: "p1", makeId, now });
    expect(activeTabIsBlank(t.snapshot)).toBe(true);
  });

  it("is false when the active tab points at a canvas", () => {
    const t = open(snap(), "p1", "dash-a");
    expect(activeTabIsBlank(t.snapshot)).toBe(false);
  });

  it("is false when the active tab is a channel tab (channel home)", () => {
    const t = openChannel(snap(), "p1", "c1");
    expect(activeTabIsBlank(t.snapshot)).toBe(false);
  });

  it("is false when there is no active tab", () => {
    expect(activeTabIsBlank(snap())).toBe(false);
  });
});

describe("closeTabs", () => {
  /** Open n dashboards in p1, returning the snapshot and ordered tab ids. */
  function openMany(n: number) {
    let s = snap();
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = open(s, "p1", `dash-${i}`);
      s = r.snapshot;
      ids.push(r.tabId);
    }
    return { s, ids };
  }

  it("is a noop for an empty or unknown id list", () => {
    const { s } = openMany(2);
    expect(closeTabs(s, [], { makeId, now })).toBe(s);
    expect(closeTabs(s, ["nope"], { makeId, now }).tabs).toHaveLength(2);
  });

  it("removes the given tabs and keeps the rest", () => {
    const { s, ids } = openMany(4);
    const r = closeTabs(s, [ids[1], ids[2]], { makeId, now });
    expect(r.tabs.map((t) => t.id)).toEqual([ids[0], ids[3]]);
    expect(r.windows).toHaveLength(1);
  });

  it("keeps the active tab focused when it survives", () => {
    const { s, ids } = openMany(3);
    const focused = closeTabs(
      setPaneActiveTab(s, "p1", ids[0]),
      [ids[1], ids[2]],
      { makeId, now },
    );
    expect(paneActive(focused, "p1")).toBe(ids[0]);
  });

  it("focuses the anchor when the active tab is closed", () => {
    const { s, ids } = openMany(4);
    // Active is ids[1]; "close others" on anchor ids[0] closes 1,2,3 → the
    // anchor takes focus even though a stored-order neighbour differs.
    const r = closeTabs(
      setPaneActiveTab(s, "p1", ids[1]),
      [ids[1], ids[2], ids[3]],
      { makeId, now },
      ids[0],
    );
    expect(paneActive(r, "p1")).toBe(ids[0]);
  });

  it("falls back to closeTab's neighbour when no anchor is given", () => {
    const { s, ids } = openMany(4);
    // Active ids[1]; closing 1,2 leaves [0,3]; the survivor at the old slot is 3.
    const r = closeTabs(setPaneActiveTab(s, "p1", ids[1]), [ids[1], ids[2]], {
      makeId,
      now,
    });
    expect(paneActive(r, "p1")).toBe(ids[3]);
  });

  it("ignores an anchor when the active tab survived", () => {
    const { s, ids } = openMany(4);
    // Active ids[0] survives; anchor must not steal focus from it.
    const r = closeTabs(
      setPaneActiveTab(s, "p1", ids[0]),
      [ids[2], ids[3]],
      { makeId, now },
      ids[1],
    );
    expect(paneActive(r, "p1")).toBe(ids[0]);
  });

  it("backfills one blank with deps.blankTabId when all of the pane's tabs close", () => {
    const { s, ids } = openMany(2);
    const r = closeTabs(s, ids, { makeId, now, blankTabId: "blank-1" });
    expect(r.tabs.map((t) => t.id)).toEqual(["blank-1"]);
    expect(paneActive(r, "p1")).toBe("blank-1");
  });

  it("anchor focus applies per pane; other panes keep their active tab", () => {
    const base = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    const a = open(base, "p1", "dash-a");
    const b = open(a.snapshot, "p1", "dash-b");
    const c = open(b.snapshot, "p1", "dash-c");
    const x = open(c.snapshot, "p2", "dash-x");
    const withActive = setPaneActiveTab(x.snapshot, "p1", b.tabId);
    const r = closeTabs(
      withActive,
      [b.tabId, c.tabId],
      { makeId, now },
      a.tabId,
    );
    expect(paneActive(r, "p1")).toBe(a.tabId);
    expect(paneActive(r, "p2")).toBe(x.tabId);
  });

  it("drops an emptied secondary window", () => {
    const base = snap([
      { id: "w1", panes: ["p1"] },
      { id: "w2", isPrimary: false, panes: ["p2"] },
    ]);
    const a = open(base, "p2", "dash-a");
    const b = open(a.snapshot, "p2", "dash-b");
    const r = closeTabs(b.snapshot, [a.tabId, b.tabId], { makeId, now });
    expect(r.windows.map((w) => w.id)).toEqual(["w1"]);
  });
});

describe("setTabOrder", () => {
  function openThree() {
    let s = snap();
    const ids: string[] = [];
    for (const d of ["a", "b", "c"]) {
      const r = open(s, "p1", `dash-${d}`);
      s = r.snapshot;
      ids.push(r.tabId);
    }
    return { s, ids };
  }

  function orderOf(s: TabsSnapshot): string[] {
    return paneTabs(s, "p1").map((t) => t.id);
  }

  it("persists the given order with clean gap positions", () => {
    const { s, ids } = openThree();
    const next = setTabOrder(s, "p1", [ids[2], ids[0], ids[1]]);
    expect(orderOf(next)).toEqual([ids[2], ids[0], ids[1]]);
    expect(paneTabs(next, "p1").map((t) => t.position)).toEqual([
      POSITION_GAP,
      2 * POSITION_GAP,
      3 * POSITION_GAP,
    ]);
  });

  it("ignores unknown ids and appends unlisted tabs in old order", () => {
    const { s, ids } = openThree();
    const next = setTabOrder(s, "p1", ["nope", ids[1]]);
    expect(orderOf(next)).toEqual([ids[1], ids[0], ids[2]]);
  });

  it("leaves other panes' tabs untouched", () => {
    const base = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    const other = open(base, "p2", "dash-z");
    const r = open(other.snapshot, "p1", "dash-a");
    const next = setTabOrder(r.snapshot, "p1", [r.tabId]);
    const p2tab = next.tabs.find((t) => t.paneId === "p2");
    expect(p2tab?.position).toBe(POSITION_GAP);
  });
});

describe("primaryWindow", () => {
  it("prefers the primary window, falling back to the first", () => {
    const s = snap([
      { id: "w2", isPrimary: false, panes: ["p2"] },
      { id: "w1", isPrimary: true, panes: ["p1"] },
    ]);
    expect(primaryWindow(s)?.id).toBe("w1");
  });
});

function openAppView(s: TabsSnapshot, paneId: string, appView: string) {
  return openOrFocusTab(s, {
    paneId,
    dashboardId: null,
    taskId: null,
    channelId: null,
    appView,
    makeId,
    now,
  });
}

describe("setPaneActiveTab", () => {
  it("focuses a tab that exists in the pane and focuses that pane", () => {
    const base = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    const a = open(base, "p1", "dash-a");
    const x = open(a.snapshot, "p2", "dash-x"); // focus now on p2
    expect(focusedPaneIdOf(x.snapshot)).toBe("p2");
    const next = setPaneActiveTab(x.snapshot, "p1", a.tabId);
    expect(paneActive(next, "p1")).toBe(a.tabId);
    expect(focusedPaneIdOf(next)).toBe("p1");
  });

  it("refocuses the pane even when its tab is already active", () => {
    const base = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    const a = open(base, "p1", "dash-a");
    const x = open(a.snapshot, "p2", "dash-x"); // p1 active=a, focus p2
    const next = setPaneActiveTab(x.snapshot, "p1", a.tabId);
    expect(paneActive(next, "p1")).toBe(a.tabId);
    expect(focusedPaneIdOf(next)).toBe("p1");
  });

  it("ignores a tab id that does not exist (dead history tag)", () => {
    const a = open(snap(), "p1", "dash-a");
    const next = setPaneActiveTab(a.snapshot, "p1", "closed-long-ago");
    expect(next).toBe(a.snapshot);
    expect(paneActive(next, "p1")).toBe(a.tabId);
  });

  it("ignores a tab that lives in another pane", () => {
    const base = snap([{ id: "w1", panes: ["p1", "p2"] }]);
    const foreign = open(base, "p2", "dash-z");
    const next = setPaneActiveTab(foreign.snapshot, "p1", foreign.tabId);
    expect(next).toBe(foreign.snapshot);
    expect(paneActive(next, "p1")).toBeNull();
  });

  it("ignores an unknown pane", () => {
    const a = open(snap(), "p1", "dash-a");
    expect(setPaneActiveTab(a.snapshot, "p-nope", a.tabId)).toBe(a.snapshot);
  });

  it("keeps snapshot identity when the tab is active and the pane focused", () => {
    const a = open(snap(), "p1", "dash-a");
    expect(setPaneActiveTab(a.snapshot, "p1", a.tabId)).toBe(a.snapshot);
  });

  it("a tab closed then re-activated by a stale id never dangles", () => {
    // The persistence-bug shape: close a tab, then a back/forward replay tries
    // to focus its id. The active tab must survive untouched — a dangling
    // activeTabId makes every later navigation open a new tab.
    const a = open(snap(), "p1", "dash-a");
    const b = open(a.snapshot, "p1", "dash-b");
    const closed = closeTab(b.snapshot, b.tabId, { makeId, now }).snapshot;
    const next = setPaneActiveTab(closed, "p1", b.tabId);
    expect(next).toBe(closed);
    expect(paneActive(next, "p1")).toBe(a.tabId);
    expect(next.tabs.some((t) => t.id === paneActive(next, "p1"))).toBe(true);
  });
});

describe("decideTabNavigation: dead history tags (back/forward over closed tabs)", () => {
  const base = {
    historyTabId: null as string | null,
    paneActiveTabId: null as string | null,
    activeTab: null as {
      id: string;
      dashboardId: string | null;
      taskId: string | null;
    } | null,
    routeDashboardId: null as string | null,
    routeTaskId: null as string | null,
    routeChannelId: null as string | null,
  };

  it("does NOT activate a tagged tab that no longer exists — replays in the active tab", () => {
    // Back onto an entry whose tab was closed: fall through to the route and
    // replace the active tab, instead of persisting a dangling activeTabId.
    expect(
      decideTabNavigation({
        ...base,
        historyTabId: "tab-closed",
        paneTabIds: ["tab-a", "tab-b"],
        paneActiveTabId: "tab-a",
        activeTab: { id: "tab-a", dashboardId: "old", taskId: null },
        routeDashboardId: "from-history",
        routeChannelId: "c1",
      }),
    ).toEqual({
      type: "replace",
      tabId: "tab-a",
      dashboardId: "from-history",
      taskId: null,
      channelId: "c1",
      channelSection: null,
      appView: null,
      stampTabId: "tab-a",
    });
  });

  it("opens a tab for a dead tag when nothing is active", () => {
    expect(
      decideTabNavigation({
        ...base,
        historyTabId: "tab-closed",
        paneTabIds: [],
        paneActiveTabId: null,
        routeDashboardId: "d1",
        routeChannelId: "c1",
      }),
    ).toEqual({
      type: "open",
      dashboardId: "d1",
      taskId: null,
      channelId: "c1",
      channelSection: null,
      appView: null,
      stampTabId: null,
    });
  });

  it("re-stamps the entry with the live active tab when the route already matches", () => {
    expect(
      decideTabNavigation({
        ...base,
        historyTabId: "tab-closed",
        paneTabIds: ["tab-a"],
        paneActiveTabId: "tab-a",
        activeTab: { id: "tab-a", dashboardId: "same", taskId: null },
        routeDashboardId: "same",
        routeChannelId: null,
      }),
    ).toEqual({ type: "stamp", stampTabId: "tab-a" });
  });

  it("still activates a live tagged tab (paneTabIds provided)", () => {
    expect(
      decideTabNavigation({
        ...base,
        historyTabId: "tab-b",
        paneTabIds: ["tab-a", "tab-b"],
        paneActiveTabId: "tab-a",
      }),
    ).toEqual({ type: "activate", tabId: "tab-b" });
  });

  it("trusts the tag when paneTabIds is omitted (legacy callers)", () => {
    expect(
      decideTabNavigation({
        ...base,
        historyTabId: "tab-b",
        paneActiveTabId: "tab-a",
      }),
    ).toEqual({ type: "activate", tabId: "tab-b" });
  });
});

describe("decideTabNavigation: app-view tabs (Inbox, Command center, …)", () => {
  const base = {
    historyTabId: null as string | null,
    paneActiveTabId: null as string | null,
    activeTab: null,
    routeDashboardId: null as string | null,
    routeTaskId: null as string | null,
    routeChannelId: null as string | null,
  };

  it("replaces the active tab in place on an untagged nav to an app view", () => {
    // The reported bug: clicking a nav item (Inbox, Command center, …) must
    // navigate IN the current tab, not open a new one.
    expect(
      decideTabNavigation({
        ...base,
        paneActiveTabId: "tab-a",
        activeTab: {
          id: "tab-a",
          dashboardId: "dash-1",
          taskId: null,
        },
        routeAppView: "inbox",
      }),
    ).toEqual({
      type: "replace",
      tabId: "tab-a",
      dashboardId: null,
      taskId: null,
      channelId: null,
      channelSection: null,
      appView: "inbox",
      stampTabId: "tab-a",
    });
  });

  it("a blank tab absorbs the first app view clicked (new-tab page keeps the URL)", () => {
    expect(
      decideTabNavigation({
        ...base,
        paneActiveTabId: "tab-blank",
        activeTab: {
          id: "tab-blank",
          dashboardId: null,
          taskId: null,
        },
        routeAppView: "command-center",
      }),
    ).toEqual({
      type: "replace",
      tabId: "tab-blank",
      dashboardId: null,
      taskId: null,
      channelId: null,
      channelSection: null,
      appView: "command-center",
      stampTabId: "tab-blank",
    });
  });

  it("only stamps when the active tab already shows the app view", () => {
    expect(
      decideTabNavigation({
        ...base,
        paneActiveTabId: "tab-a",
        activeTab: {
          id: "tab-a",
          dashboardId: null,
          taskId: null,
          appView: "inbox",
        },
        routeAppView: "inbox",
      }),
    ).toEqual({ type: "stamp", stampTabId: "tab-a" });
  });

  it("switching between app views replaces in place (no duplicate tab)", () => {
    expect(
      decideTabNavigation({
        ...base,
        paneActiveTabId: "tab-a",
        activeTab: {
          id: "tab-a",
          dashboardId: null,
          taskId: null,
          appView: "inbox",
        },
        routeAppView: "skills",
      }),
    ).toEqual({
      type: "replace",
      tabId: "tab-a",
      dashboardId: null,
      taskId: null,
      channelId: null,
      channelSection: null,
      appView: "skills",
      stampTabId: "tab-a",
    });
  });

  it("opens a tab for an app view when nothing is active", () => {
    expect(
      decideTabNavigation({
        ...base,
        routeAppView: "agents",
      }),
    ).toEqual({
      type: "open",
      dashboardId: null,
      taskId: null,
      channelId: null,
      channelSection: null,
      appView: "agents",
      stampTabId: null,
    });
  });
});

describe("openOrFocusTab: app-view identity", () => {
  it("dedups the same app view instead of opening a second tab", () => {
    const first = openAppView(snap(), "p1", "inbox");
    const second = openAppView(first.snapshot, "p1", "inbox");
    expect(second.opened).toBe(false);
    expect(second.tabId).toBe(first.tabId);
    expect(second.snapshot.tabs).toHaveLength(1);
  });

  it("treats different app views as distinct tabs", () => {
    const inbox = openAppView(snap(), "p1", "inbox");
    const skills = openAppView(inbox.snapshot, "p1", "skills");
    expect(skills.opened).toBe(true);
    expect(skills.snapshot.tabs).toHaveLength(2);
  });

  it("an app-view tab and a blank tab are distinct identities", () => {
    const blank = newBlankTab(snap(), { paneId: "p1", makeId, now });
    const inbox = openAppView(blank.snapshot, "p1", "inbox");
    expect(inbox.opened).toBe(true);
    expect(inbox.snapshot.tabs).toHaveLength(2);
  });
});

describe("setTabTarget: app views", () => {
  it("points a blank tab at an app view and back to blank", () => {
    const blank = newBlankTab(snap(), { paneId: "p1", makeId, now });
    const withView = setTabTarget(blank.snapshot, {
      tabId: blank.tabId,
      dashboardId: null,
      taskId: null,
      channelId: null,
      appView: "command-center",
      now,
    });
    expect(withView.tabs[0].appView).toBe("command-center");
    expect(activeTabIsBlank(withView)).toBe(false);

    const backToBlank = setTabTarget(withView, {
      tabId: blank.tabId,
      dashboardId: null,
      taskId: null,
      channelId: null,
      now,
    });
    expect(backToBlank.tabs[0].appView).toBeNull();
    expect(activeTabIsBlank(backToBlank)).toBe(true);
  });

  it("clears the app view when the tab navigates to a canvas", () => {
    const inbox = openAppView(snap(), "p1", "inbox");
    const next = setTabTarget(inbox.snapshot, {
      tabId: inbox.tabId,
      dashboardId: "dash-1",
      taskId: null,
      channelId: "c1",
      now,
    });
    const tab = next.tabs.find((t) => t.id === inbox.tabId);
    expect(tab?.appView).toBeNull();
    expect(tab?.dashboardId).toBe("dash-1");
  });
});

describe("regression: the reported tab-persistence bugs", () => {
  // Three tabs; the third is active (this is the persisted boot state in the
  // report: "my third tab is taking the URL of any URL I try on tab 1/2").
  function threeTabs() {
    const t1 = open(snap(), "p1", "dash-1");
    const t2 = open(t1.snapshot, "p1", "dash-2");
    const t3 = open(t2.snapshot, "p1", "dash-3");
    return { s: t3.snapshot, ids: [t1.tabId, t2.tabId, t3.tabId] as const };
  }

  it("a navigation after a tab switch writes to the switched tab, not the previous one", () => {
    const { s, ids } = threeTabs();
    const [t1, , t3] = ids;
    expect(paneActive(s, "p1")).toBe(t3);

    // User clicks tab 1 in the strip → the entry is tagged t1 → activate.
    const clickTab1 = decideTabNavigation({
      historyTabId: t1,
      paneTabIds: ids,
      paneActiveTabId: t3,
      activeTab: null,
      routeDashboardId: "dash-1",
      routeTaskId: null,
      routeChannelId: "c1",
    });
    expect(clickTab1).toEqual({ type: "activate", tabId: t1 });

    // The strip applies the focus to its mirror synchronously (the fix): the
    // next decision must see t1 active, NOT the stale t3.
    const afterSwitch = setPaneActiveTab(s, "p1", t1);
    expect(paneActive(afterSwitch, "p1")).toBe(t1);

    // User clicks a nav item (untagged navigation). It must replace t1.
    const activeTab = afterSwitch.tabs.find((t) => t.id === t1);
    const navToInbox = decideTabNavigation({
      historyTabId: null,
      paneTabIds: ids,
      paneActiveTabId: t1,
      activeTab: activeTab
        ? {
            id: activeTab.id,
            dashboardId: activeTab.dashboardId,
            taskId: activeTab.taskId,
            channelId: activeTab.channelId,
            channelSection: activeTab.channelSection,
            appView: activeTab.appView,
          }
        : null,
      routeDashboardId: null,
      routeTaskId: null,
      routeChannelId: null,
      routeAppView: "inbox",
    });
    expect(navToInbox.type).toBe("replace");
    if (navToInbox.type !== "replace") throw new Error("unreachable");
    expect(navToInbox.tabId).toBe(t1);

    // Apply the write: only t1 changed; t3 keeps its canvas.
    const applied = setTabTarget(afterSwitch, {
      tabId: navToInbox.tabId,
      dashboardId: navToInbox.dashboardId,
      taskId: navToInbox.taskId,
      channelId: navToInbox.channelId,
      channelSection: navToInbox.channelSection,
      appView: navToInbox.appView,
      now,
    });
    expect(applied.tabs.find((t) => t.id === t1)?.appView).toBe("inbox");
    expect(applied.tabs.find((t) => t.id === t3)?.dashboardId).toBe("dash-3");
    expect(applied.tabs.find((t) => t.id === ids[1])?.dashboardId).toBe(
      "dash-2",
    );
  });

  it("switching tabs never rewrites the target tab's contents", () => {
    const { s, ids } = threeTabs();
    const [t1, t2] = ids;
    // Switch t3 → t2 → t1: pure focus changes.
    let cur = setPaneActiveTab(s, "p1", t2);
    cur = setPaneActiveTab(cur, "p1", t1);
    expect(cur.tabs.find((t) => t.id === t1)?.dashboardId).toBe("dash-1");
    expect(cur.tabs.find((t) => t.id === t2)?.dashboardId).toBe("dash-2");
    expect(cur.tabs.find((t) => t.id === ids[2])?.dashboardId).toBe("dash-3");
    // Tab records are untouched by focus changes — same array identity.
    expect(cur.tabs).toBe(s.tabs);
  });

  it("back over a closed tab's entry cannot dangle focus and flood new tabs", () => {
    const { s, ids } = threeTabs();
    const [t1, , t3] = ids;
    // Close t1, then replay a history entry tagged with it.
    const closed = closeTabs(s, [t1], { makeId, now });
    const live = closed.tabs.map((t) => t.id);
    const decision = decideTabNavigation({
      historyTabId: t1,
      paneTabIds: live,
      paneActiveTabId: paneActive(closed, "p1"),
      activeTab: (() => {
        const active = closed.tabs.find(
          (t) => t.id === paneActive(closed, "p1"),
        );
        return active
          ? {
              id: active.id,
              dashboardId: active.dashboardId,
              taskId: active.taskId,
              channelId: active.channelId,
              channelSection: active.channelSection,
              appView: active.appView,
            }
          : null;
      })(),
      routeDashboardId: "dash-1",
      routeTaskId: null,
      routeChannelId: "c1",
    });
    // Never "activate" the dead id — the route replays in the active tab.
    expect(decision.type).toBe("replace");
    if (decision.type !== "replace") throw new Error("unreachable");
    expect(live).toContain(decision.tabId);
    expect(decision.tabId).toBe(t3);

    // And even a hostile setPaneActiveTab with the dead id is a validated no-op.
    expect(setPaneActiveTab(closed, "p1", t1)).toBe(closed);
  });

  it("a new blank tab stays blank until the user navigates, then keeps that URL", () => {
    const withTabs = open(snap(), "p1", "dash-1");
    const blank = newBlankTab(withTabs.snapshot, { paneId: "p1", makeId, now });
    expect(activeTabIsBlank(blank.snapshot)).toBe(true);

    // The landing route is a noop — nothing may rewrite the blank tab.
    const onLanding = decideTabNavigation({
      historyTabId: blank.tabId,
      paneTabIds: blank.snapshot.tabs.map((t) => t.id),
      paneActiveTabId: blank.tabId,
      activeTab: {
        id: blank.tabId,
        dashboardId: null,
        taskId: null,
        channelId: null,
        channelSection: null,
        appView: null,
      },
      routeDashboardId: null,
      routeTaskId: null,
      routeChannelId: null,
      routeAppView: null,
    });
    expect(onLanding).toEqual({ type: "noop" });

    // First click (Command center) replaces the blank tab in place…
    const firstNav = decideTabNavigation({
      historyTabId: blank.tabId,
      paneTabIds: blank.snapshot.tabs.map((t) => t.id),
      paneActiveTabId: blank.tabId,
      activeTab: {
        id: blank.tabId,
        dashboardId: null,
        taskId: null,
        channelId: null,
        channelSection: null,
        appView: null,
      },
      routeDashboardId: null,
      routeTaskId: null,
      routeChannelId: null,
      routeAppView: "command-center",
    });
    expect(firstNav.type).toBe("replace");
    if (firstNav.type !== "replace") throw new Error("unreachable");
    expect(firstNav.tabId).toBe(blank.tabId);

    const applied = setTabTarget(blank.snapshot, {
      tabId: firstNav.tabId,
      dashboardId: firstNav.dashboardId,
      taskId: firstNav.taskId,
      channelId: firstNav.channelId,
      channelSection: firstNav.channelSection,
      appView: firstNav.appView,
      now,
    });
    // …and the other tab keeps its canvas untouched.
    expect(applied.tabs.find((t) => t.id === blank.tabId)?.appView).toBe(
      "command-center",
    );
    expect(applied.tabs.find((t) => t.id === withTabs.tabId)?.dashboardId).toBe(
      "dash-1",
    );
  });
});

describe("activeTabIsBlank: app views", () => {
  it("is false when the active tab shows an app view", () => {
    const t = openAppView(snap(), "p1", "inbox");
    expect(activeTabIsBlank(t.snapshot)).toBe(false);
  });
});
