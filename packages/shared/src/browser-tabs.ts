import {
  collectLeafPaneIds,
  insertPaneInLayout,
  normalizeLayout,
  removePaneFromLayout,
  setSplitSizesAtPath,
} from "./browser-pane-layout";
import type {
  BrowserPane,
  BrowserTab,
  SplitDropDirection,
  TabsSnapshot,
} from "./browser-tabs-schemas";

/** Spacing between adjacent tab positions, leaving room to insert without reindex. */
export const POSITION_GAP = 1000;

type Clock = () => number;
type IdFactory = () => string;

export type OpenTabResult = {
  snapshot: TabsSnapshot;
  tabId: string;
  /** False when an existing tab was focused (dedup) rather than created. */
  opened: boolean;
};

export type CloseTabResult = {
  snapshot: TabsSnapshot;
  /** Tab focused in the pane after the close (the blank backfill when the
   * pane emptied), or null when the whole window closed. */
  nextActiveTabId: string | null;
  /** Set when closing the last tab of a single-pane secondary window should
   * close the window itself. */
  closedWindowId: string | null;
};

export type SplitPaneResult = {
  snapshot: TabsSnapshot;
  /** The pane now holding the dragged tab. */
  paneId: string;
};

export type ClosePaneResult = {
  snapshot: TabsSnapshot;
  /** Set when closing the last pane of a secondary window closed the window. */
  closedWindowId: string | null;
};

/** Ids a close-path transform needs: succession timestamps plus the minted id
 * for a blank backfill (renderer-minted so the optimistic apply and the
 * persisted state agree — blank tabs have no identity to dedup on). */
export type CloseDeps = { makeId: IdFactory; now: Clock; blankTabId?: string };

function tabsInPane(snapshot: TabsSnapshot, paneId: string): BrowserTab[] {
  return snapshot.tabs
    .filter((t) => t.paneId === paneId)
    .sort((a, b) => a.position - b.position);
}

/** The primary window, falling back to the first one (web has a single window). */
export function primaryWindow(snapshot: TabsSnapshot) {
  return snapshot.windows.find((w) => w.isPrimary) ?? snapshot.windows[0];
}

function paneById(
  snapshot: TabsSnapshot,
  paneId: string,
): BrowserPane | undefined {
  return snapshot.panes.find((p) => p.id === paneId);
}

/** The window's focused pane, falling back to its first layout leaf. */
export function focusedPane(
  snapshot: TabsSnapshot,
  windowId: string,
): BrowserPane | undefined {
  const window = snapshot.windows.find((w) => w.id === windowId);
  if (!window) return undefined;
  const focused = snapshot.panes.find(
    (p) => p.id === window.focusedPaneId && p.windowId === windowId,
  );
  if (focused) return focused;
  const firstLeaf = collectLeafPaneIds(window.layout)[0];
  return firstLeaf ? paneById(snapshot, firstLeaf) : undefined;
}

/** The focused pane's active tab — "the tab the window is looking at". */
export function windowActiveTab(
  snapshot: TabsSnapshot,
  windowId: string,
): BrowserTab | undefined {
  const pane = focusedPane(snapshot, windowId);
  if (!pane?.activeTabId) return undefined;
  return snapshot.tabs.find((t) => t.id === pane.activeTabId);
}

/** A pane's tabs in stored (position) order. */
export function paneTabs(snapshot: TabsSnapshot, paneId: string): BrowserTab[] {
  return tabsInPane(snapshot, paneId);
}

/** A window's pane ids in layout (display) order. */
export function windowPaneIds(
  snapshot: TabsSnapshot,
  windowId: string,
): string[] {
  const window = snapshot.windows.find((w) => w.id === windowId);
  return window ? collectLeafPaneIds(window.layout) : [];
}

function isBlankIdentity(t: {
  dashboardId: string | null;
  taskId: string | null;
  channelId?: string | null;
  appView?: string | null;
}): boolean {
  return (
    t.dashboardId == null &&
    t.taskId == null &&
    (t.channelId ?? null) == null &&
    (t.appView ?? null) == null
  );
}

/**
 * True when the primary window's focused pane shows a blank "+" tab: no
 * canvas, task, or channel. The blank tab parks at the channels index
 * (`/website`), whose route would otherwise redirect to the first channel —
 * callers use this to suppress that redirect so the blank tab (and the
 * in-flight navigation leaving it) isn't hijacked to `channels[0]`.
 */
export function activeTabIsBlank(snapshot: TabsSnapshot): boolean {
  const w = primaryWindow(snapshot);
  if (!w) return false;
  const t = windowActiveTab(snapshot, w.id);
  return !!t && isBlankIdentity(t);
}

function setPaneActive(
  snapshot: TabsSnapshot,
  paneId: string,
  tabId: string | null,
): TabsSnapshot {
  return {
    ...snapshot,
    panes: snapshot.panes.map((p) =>
      p.id === paneId ? { ...p, activeTabId: tabId } : p,
    ),
  };
}

function setFocused(
  snapshot: TabsSnapshot,
  windowId: string,
  paneId: string,
): TabsSnapshot {
  return {
    ...snapshot,
    windows: snapshot.windows.map((w) =>
      w.id === windowId && w.focusedPaneId !== paneId
        ? { ...w, focusedPaneId: paneId }
        : w,
    ),
  };
}

/** Focus a pane's tab AND focus that pane in its window — clicking a tab
 * focuses the pane it lives in. */
function focusTabInPane(
  snapshot: TabsSnapshot,
  paneId: string,
  tabId: string | null,
): TabsSnapshot {
  const pane = paneById(snapshot, paneId);
  if (!pane) return snapshot;
  return setFocused(
    setPaneActive(snapshot, paneId, tabId),
    pane.windowId,
    paneId,
  );
}

/**
 * Focus a tab in its pane, validating the target: the tab must exist and live
 * in that pane, otherwise the snapshot is returned unchanged. This is the
 * persistence-safe primitive — history entries can carry ids of tabs closed
 * since (back/forward replay), and blindly persisting such an id leaves the
 * pane with a dangling activeTabId, after which every navigation looks like
 * "no active tab" and opens a new tab. Also focuses the pane in its window.
 */
export function setPaneActiveTab(
  snapshot: TabsSnapshot,
  paneId: string,
  tabId: string,
): TabsSnapshot {
  const tab = snapshot.tabs.find((t) => t.id === tabId);
  if (!tab || tab.paneId !== paneId) return snapshot;
  const pane = paneById(snapshot, paneId);
  if (!pane) return snapshot;
  const window = snapshot.windows.find((w) => w.id === pane.windowId);
  if (pane.activeTabId === tabId && window?.focusedPaneId === paneId) {
    return snapshot;
  }
  return focusTabInPane(snapshot, paneId, tabId);
}

/**
 * Focus a pane, validated: it must exist, belong to the window, and be a live
 * leaf of the window's layout — otherwise the snapshot is returned unchanged.
 */
export function setFocusedPane(
  snapshot: TabsSnapshot,
  windowId: string,
  paneId: string,
): TabsSnapshot {
  const window = snapshot.windows.find((w) => w.id === windowId);
  if (!window || window.focusedPaneId === paneId) return snapshot;
  const pane = paneById(snapshot, paneId);
  if (!pane || pane.windowId !== windowId) return snapshot;
  if (!collectLeafPaneIds(window.layout).includes(paneId)) return snapshot;
  return setFocused(snapshot, windowId, paneId);
}

/** What a tab points at: a canvas, a task, or neither (blank). */
export type TabTarget = {
  dashboardId: string | null;
  taskId: string | null;
};

/**
 * Everything that identifies a tab's contents: a canvas, a task, or a channel
 * sub-section (channel + section). Two tabs with the same identity are the same
 * page, so dedup and in-tab-nav comparisons key on all four — a channel's
 * `history` and `artifacts`, or two channels' artifacts, are distinct pages.
 */
export type TabIdentity = {
  dashboardId: string | null;
  taskId: string | null;
  channelId: string | null;
  channelSection: string | null;
  appView: string | null;
};

function sameIdentity(a: TabIdentity, b: TabIdentity): boolean {
  return (
    a.dashboardId === b.dashboardId &&
    a.taskId === b.taskId &&
    a.channelId === b.channelId &&
    a.channelSection === b.channelSection &&
    a.appView === b.appView
  );
}

/**
 * Open a target (canvas or task) in a pane, deduping within that pane: if a
 * tab for the same target already exists in the pane it is focused, otherwise
 * a new tab is appended. Duplicates across different panes are allowed here —
 * the navigation layer decides whether to focus another pane instead (see
 * {@link decideTabNavigation}'s `focusPane`).
 */
export function openOrFocusTab(
  snapshot: TabsSnapshot,
  input: TabTarget & {
    paneId: string;
    channelId: string | null;
    channelSection?: string | null;
    appView?: string | null;
    makeId: IdFactory;
    now: Clock;
  },
): OpenTabResult {
  const { paneId, dashboardId, taskId, channelId, makeId, now } = input;
  const channelSection = input.channelSection ?? null;
  const appView = input.appView ?? null;
  const existing = snapshot.tabs.find(
    (t) =>
      t.paneId === paneId &&
      sameIdentity(t, {
        dashboardId,
        taskId,
        channelId,
        channelSection,
        appView,
      }),
  );
  if (existing) {
    const ts = now();
    const withActivity: TabsSnapshot = {
      ...snapshot,
      tabs: snapshot.tabs.map((t) =>
        t.id === existing.id ? { ...t, lastActiveAt: ts } : t,
      ),
    };
    return {
      snapshot: focusTabInPane(withActivity, paneId, existing.id),
      tabId: existing.id,
      opened: false,
    };
  }

  return appendTab(snapshot, {
    paneId,
    dashboardId,
    taskId,
    channelId,
    channelSection,
    appView,
    makeId,
    now,
  });
}

function appendTab(
  snapshot: TabsSnapshot,
  input: TabTarget & {
    paneId: string;
    channelId: string | null;
    channelSection?: string | null;
    appView?: string | null;
    makeId: IdFactory;
    now: Clock;
  },
): OpenTabResult {
  const { paneId, dashboardId, taskId, channelId, makeId, now } = input;
  const pane = paneById(snapshot, paneId);
  if (!pane) return { snapshot, tabId: "", opened: false };
  const siblings = tabsInPane(snapshot, paneId);
  const lastPos = siblings.length ? siblings[siblings.length - 1].position : 0;
  const ts = now();
  const tab: BrowserTab = {
    id: makeId(),
    windowId: pane.windowId,
    paneId,
    dashboardId,
    taskId,
    channelId,
    channelSection: input.channelSection ?? null,
    appView: input.appView ?? null,
    position: lastPos + POSITION_GAP,
    scrollState: null,
    createdAt: ts,
    lastActiveAt: ts,
  };
  const withTab: TabsSnapshot = { ...snapshot, tabs: [...snapshot.tabs, tab] };
  return {
    snapshot: focusTabInPane(withTab, paneId, tab.id),
    tabId: tab.id,
    opened: true,
  };
}

/**
 * Append a blank tab (no target) and focus it. The strip shows it as an empty
 * placeholder; navigating while it is active replaces its contents via
 * {@link setTabTarget}.
 */
export function newBlankTab(
  snapshot: TabsSnapshot,
  input: { paneId: string; makeId: IdFactory; now: Clock },
): OpenTabResult {
  return appendTab(snapshot, {
    paneId: input.paneId,
    dashboardId: null,
    taskId: null,
    channelId: null,
    makeId: input.makeId,
    now: input.now,
  });
}

/**
 * Point an existing tab at a target (canvas or task) — the in-tab navigation
 * primitive. Used when the user navigates while a tab is active, so the target
 * replaces the tab's contents instead of opening a new tab. Also focuses the
 * tab and its pane.
 */
export function setTabTarget(
  snapshot: TabsSnapshot,
  input: TabTarget & {
    tabId: string;
    channelId: string | null;
    channelSection?: string | null;
    appView?: string | null;
    now: Clock;
  },
): TabsSnapshot {
  const tab = snapshot.tabs.find((t) => t.id === input.tabId);
  if (!tab) return snapshot;
  const ts = input.now();
  const withTarget: TabsSnapshot = {
    ...snapshot,
    tabs: snapshot.tabs.map((t) =>
      t.id === input.tabId
        ? {
            ...t,
            dashboardId: input.dashboardId,
            taskId: input.taskId,
            channelId: input.channelId,
            channelSection: input.channelSection ?? null,
            appView: input.appView ?? null,
            lastActiveAt: ts,
          }
        : t,
    ),
  };
  return focusTabInPane(withTarget, tab.paneId, input.tabId);
}

/** Remove a pane row and its layout leaf, moving window focus to the first
 * remaining leaf. Assumes the pane's tabs are already gone or reparented. */
function dropPane(snapshot: TabsSnapshot, pane: BrowserPane): TabsSnapshot {
  const window = snapshot.windows.find((w) => w.id === pane.windowId);
  if (!window) {
    return {
      ...snapshot,
      panes: snapshot.panes.filter((p) => p.id !== pane.id),
    };
  }
  const layout = removePaneFromLayout(window.layout, pane.id);
  if (layout === null) {
    // Callers guarantee this never drops a window's last pane.
    return snapshot;
  }
  const focusedPaneId =
    window.focusedPaneId === pane.id
      ? collectLeafPaneIds(layout)[0]
      : window.focusedPaneId;
  return {
    ...snapshot,
    windows: snapshot.windows.map((w) =>
      w.id === window.id ? { ...w, layout, focusedPaneId } : w,
    ),
    panes: snapshot.panes.filter((p) => p.id !== pane.id),
  };
}

/**
 * Close a tab. Focus moves to the nearest sibling in the pane. Closing the
 * pane's last tab backfills a blank tab (panes never auto-collapse on close;
 * they collapse only via {@link closePane} or when a move/split empties them)
 * — EXCEPT the last tab of a single-pane secondary window, which still closes
 * the window (otherwise secondary windows become unkillable from the strip).
 */
export function closeTab(
  snapshot: TabsSnapshot,
  tabId: string,
  deps: CloseDeps,
): CloseTabResult {
  const tab = snapshot.tabs.find((t) => t.id === tabId);
  if (!tab) {
    return { snapshot, nextActiveTabId: null, closedWindowId: null };
  }
  const pane = paneById(snapshot, tab.paneId);
  const window = snapshot.windows.find((w) => w.id === tab.windowId);
  const siblings = tabsInPane(snapshot, tab.paneId);
  const idx = siblings.findIndex((t) => t.id === tabId);
  const remaining = siblings.filter((t) => t.id !== tabId);

  const removedTabs = snapshot.tabs.filter((t) => t.id !== tabId);

  if (remaining.length === 0) {
    const isOnlyPane =
      !!window && collectLeafPaneIds(window.layout).length === 1;
    if (window && !window.isPrimary && isOnlyPane) {
      // Drop the window (and its pane) too.
      return {
        snapshot: {
          windows: snapshot.windows.filter((w) => w.id !== window.id),
          panes: snapshot.panes.filter((p) => p.windowId !== window.id),
          tabs: removedTabs,
        },
        nextActiveTabId: null,
        closedWindowId: window.id,
      };
    }
    // Pane stays; backfill a blank tab so it always has something to show.
    const base: TabsSnapshot = { ...snapshot, tabs: removedTabs };
    const blank = newBlankTab(base, {
      paneId: tab.paneId,
      makeId: deps.blankTabId ? () => deps.blankTabId as string : deps.makeId,
      now: deps.now,
    });
    return {
      snapshot: blank.snapshot,
      nextActiveTabId: blank.tabId,
      closedWindowId: null,
    };
  }

  // Focus the tab that took the closed slot, else the new last one.
  const next = remaining[Math.min(idx, remaining.length - 1)];
  const wasActive = pane?.activeTabId === tabId;
  const base: TabsSnapshot = { ...snapshot, tabs: removedTabs };
  return {
    snapshot: wasActive ? setPaneActive(base, tab.paneId, next.id) : base,
    nextActiveTabId: wasActive ? next.id : (pane?.activeTabId ?? null),
    closedWindowId: null,
  };
}

/**
 * Close several tabs at once — the bulk primitive behind "close other tabs" /
 * "close tabs to the right/left". Composes {@link closeTab} so the per-pane
 * succession rules (survivor focus, blank backfill, secondary-window drop)
 * live in exactly one place.
 *
 * `focusTabId` is the bulk close's anchor (the right-clicked tab, which always
 * survives these operations). When a pane's active tab is among those closed,
 * focus moves to the anchor rather than closeTab's stored-order neighbour — the
 * caller closes by *displayed* (pinned-first) order, so the stored-order
 * neighbour can be a pinned tab at the far end of the strip.
 *
 * A bulk close targets one strip, so at most one pane can empty — the single
 * `deps.blankTabId` covers it (further backfills fall back to `makeId`).
 */
export function closeTabs(
  snapshot: TabsSnapshot,
  tabIds: string[],
  deps: CloseDeps,
  focusTabId?: string | null,
): TabsSnapshot {
  const ids = new Set(tabIds);
  if (ids.size === 0) return snapshot;

  // Panes whose active tab is being closed — only these honour the anchor.
  const activeClosedPanes = new Set(
    snapshot.panes
      .filter((p) => p.activeTabId != null && ids.has(p.activeTabId))
      .map((p) => p.id),
  );

  let next = snapshot;
  let blankTabId = deps.blankTabId;
  for (const id of ids) {
    next = closeTab(next, id, { ...deps, blankTabId }).snapshot;
    // The minted blank id is single-use; a second emptied pane gets makeId.
    if (blankTabId && next.tabs.some((t) => t.id === blankTabId)) {
      blankTabId = undefined;
    }
  }

  if (focusTabId) {
    const anchor = next.tabs.find((t) => t.id === focusTabId);
    if (anchor && activeClosedPanes.has(anchor.paneId)) {
      next = setPaneActive(next, anchor.paneId, focusTabId);
    }
  }
  return next;
}

/**
 * Persist a pane's full tab order — the drop primitive for drag-to-reorder.
 * The UI sends the final stored order (pin-agnostic; the pinned-first display
 * partition is applied on top at render time) and it becomes the stored order.
 * Ids not in the pane are ignored; the pane's tabs missing from the list keep
 * their relative order after the listed ones. Tabs whose position does not
 * change keep their object identity so downstream memos/effects stay stable.
 */
export function setTabOrder(
  snapshot: TabsSnapshot,
  paneId: string,
  orderedTabIds: string[],
): TabsSnapshot {
  const current = tabsInPane(snapshot, paneId);
  const byId = new Map(current.map((t) => [t.id, t]));
  const listed = orderedTabIds
    .map((id) => byId.get(id))
    .filter((t): t is BrowserTab => t !== undefined);
  const listedIds = new Set(listed.map((t) => t.id));
  const rest = current.filter((t) => !listedIds.has(t.id));
  const positioned = new Map<string, number>(
    [...listed, ...rest].map((t, i) => [t.id, (i + 1) * POSITION_GAP]),
  );
  let changed = false;
  const tabs = snapshot.tabs.map((t) => {
    const pos = positioned.get(t.id);
    if (pos === undefined || pos === t.position) return t;
    changed = true;
    return { ...t, position: pos };
  });
  return changed ? { ...snapshot, tabs } : snapshot;
}

// ----- Pane structure transforms (split / move / close / resize) -----

/**
 * Detach a tab from its pane ahead of a reparent: fixes the source pane's
 * active-tab succession, and collapses the pane when the tab was its last
 * (a pane emptied by a move/split collapses — blank backfill is only for the
 * tab-CLOSE path, or rearranging would litter blank panes). The tab itself is
 * NOT removed from `snapshot.tabs`; the caller rewrites it.
 */
function detachTabFromPane(
  snapshot: TabsSnapshot,
  tab: BrowserTab,
): TabsSnapshot {
  const pane = paneById(snapshot, tab.paneId);
  if (!pane) return snapshot;
  const siblings = tabsInPane(snapshot, tab.paneId);
  const remaining = siblings.filter((t) => t.id !== tab.id);
  if (remaining.length === 0) {
    return dropPane(snapshot, pane);
  }
  if (pane.activeTabId !== tab.id) return snapshot;
  const idx = siblings.findIndex((t) => t.id === tab.id);
  const next = remaining[Math.min(idx, remaining.length - 1)];
  return setPaneActive(snapshot, tab.paneId, next.id);
}

/**
 * Split: create a new pane adjacent to `targetPaneId` (null = the window
 * root) on the `direction` side and move the dragged tab into it. The new
 * pane becomes the window's focused pane. Idempotent on the renderer-minted
 * `newPaneId` (a replay returns the snapshot unchanged). No-ops: unknown
 * tab/target, cross-window target, or splitting a pane's only tab against
 * that same pane (which would just recreate the current layout).
 */
export function splitPane(
  snapshot: TabsSnapshot,
  input: {
    windowId: string;
    targetPaneId: string | null;
    direction: SplitDropDirection;
    tabId: string;
    newPaneId: string;
    now: Clock;
  },
): SplitPaneResult {
  const { windowId, targetPaneId, direction, tabId, newPaneId, now } = input;
  if (paneById(snapshot, newPaneId)) {
    return { snapshot, paneId: newPaneId };
  }
  const window = snapshot.windows.find((w) => w.id === windowId);
  const tab = snapshot.tabs.find((t) => t.id === tabId);
  if (!window || !tab || tab.windowId !== windowId) {
    return { snapshot, paneId: tab?.paneId ?? "" };
  }
  if (targetPaneId !== null) {
    const target = paneById(snapshot, targetPaneId);
    if (!target || target.windowId !== windowId) {
      return { snapshot, paneId: tab.paneId };
    }
  }
  const sourceTabs = tabsInPane(snapshot, tab.paneId);
  const sourceIsSoleTab = sourceTabs.length === 1;
  const targetsOwnPane = targetPaneId === tab.paneId;
  const singlePaneRoot =
    targetPaneId === null &&
    collectLeafPaneIds(window.layout).length === 1 &&
    collectLeafPaneIds(window.layout)[0] === tab.paneId;
  if (sourceIsSoleTab && (targetsOwnPane || singlePaneRoot)) {
    return { snapshot, paneId: tab.paneId };
  }

  const ts = now();
  const pane: BrowserPane = {
    id: newPaneId,
    windowId,
    activeTabId: tabId,
    createdAt: ts,
  };
  // Detach first (fixes source succession / collapses an emptied source),
  // then grow the layout — insertPaneInLayout must see the post-collapse tree.
  let next = detachTabFromPane(
    { ...snapshot, panes: [...snapshot.panes, pane] },
    tab,
  );
  const win = next.windows.find((w) => w.id === windowId);
  if (!win) return { snapshot, paneId: tab.paneId };
  const layout = insertPaneInLayout(
    win.layout,
    targetPaneId,
    direction,
    newPaneId,
  );
  next = {
    ...next,
    windows: next.windows.map((w) =>
      w.id === windowId ? { ...w, layout, focusedPaneId: newPaneId } : w,
    ),
    tabs: next.tabs.map((t) =>
      t.id === tabId
        ? {
            ...t,
            paneId: newPaneId,
            windowId,
            position: POSITION_GAP,
            lastActiveAt: ts,
          }
        : t,
    ),
  };
  return { snapshot: next, paneId: newPaneId };
}

/**
 * Move a tab into another pane (drop on a strip or a pane's center zone).
 * Appended at the pane's tail unless `index` gives a displayed slot. The tab
 * becomes the destination pane's active tab and the pane takes window focus.
 * NO identity dedup — a deliberate drag may duplicate an identity across
 * panes (dedup is an openOrFocus concern). A source pane emptied by the move
 * collapses. No-op when the destination is the tab's own pane.
 */
export function moveTabToPane(
  snapshot: TabsSnapshot,
  input: { tabId: string; toPaneId: string; index?: number; now: Clock },
): TabsSnapshot {
  const { tabId, toPaneId, now } = input;
  const tab = snapshot.tabs.find((t) => t.id === tabId);
  const to = paneById(snapshot, toPaneId);
  if (!tab || !to || tab.paneId === toPaneId) return snapshot;

  const ts = now();
  let next = detachTabFromPane(snapshot, tab);

  const dest = tabsInPane(next, toPaneId);
  const insertAt = Math.max(
    0,
    Math.min(input.index ?? dest.length, dest.length),
  );
  const ordered = [...dest.map((t) => t.id)];
  ordered.splice(insertAt, 0, tabId);
  const positioned = new Map(
    ordered.map((id, i) => [id, (i + 1) * POSITION_GAP]),
  );

  next = {
    ...next,
    tabs: next.tabs.map((t) => {
      if (t.id === tabId) {
        return {
          ...t,
          paneId: toPaneId,
          windowId: to.windowId,
          position: positioned.get(tabId) ?? (dest.length + 1) * POSITION_GAP,
          lastActiveAt: ts,
        };
      }
      const pos = positioned.get(t.id);
      return pos !== undefined && pos !== t.position
        ? { ...t, position: pos }
        : t;
    }),
  };
  return focusTabInPane(next, toPaneId, tabId);
}

/**
 * Explicitly close a pane: closes ALL its tabs and collapses its layout leaf
 * (neighbours reclaim the space). Closing the last pane of a secondary window
 * closes the window; on the primary window the pane is reset to a fresh blank
 * tab instead (the UI hides the affordance at one pane — this is the safety
 * net). Idempotent: unknown pane → snapshot unchanged.
 */
export function closePane(
  snapshot: TabsSnapshot,
  input: { windowId: string; paneId: string } & CloseDeps,
): ClosePaneResult {
  const { windowId, paneId } = input;
  const window = snapshot.windows.find((w) => w.id === windowId);
  const pane = paneById(snapshot, paneId);
  if (!window || !pane || pane.windowId !== windowId) {
    return { snapshot, closedWindowId: null };
  }
  const isOnlyPane = collectLeafPaneIds(window.layout).length === 1;
  const withoutTabs: TabsSnapshot = {
    ...snapshot,
    tabs: snapshot.tabs.filter((t) => t.paneId !== paneId),
  };
  if (isOnlyPane) {
    if (!window.isPrimary) {
      return {
        snapshot: {
          windows: withoutTabs.windows.filter((w) => w.id !== windowId),
          panes: withoutTabs.panes.filter((p) => p.windowId !== windowId),
          tabs: withoutTabs.tabs,
        },
        closedWindowId: windowId,
      };
    }
    // Primary window safety net: keep the pane, reset it to one blank tab.
    const blank = newBlankTab(withoutTabs, {
      paneId,
      makeId: input.blankTabId
        ? () => input.blankTabId as string
        : input.makeId,
      now: input.now,
    });
    return { snapshot: blank.snapshot, closedWindowId: null };
  }
  return { snapshot: dropPane(withoutTabs, pane), closedWindowId: null };
}

/**
 * Set the sizes of one split in a window's layout, addressed by child-index
 * path (see `setSplitSizesAtPath`). Validated no-op on a bad path or sizes.
 */
export function setPaneSizes(
  snapshot: TabsSnapshot,
  windowId: string,
  path: number[],
  sizes: number[],
): TabsSnapshot {
  const window = snapshot.windows.find((w) => w.id === windowId);
  if (!window) return snapshot;
  const layout = setSplitSizesAtPath(window.layout, path, sizes);
  if (layout === window.layout) return snapshot;
  return {
    ...snapshot,
    windows: snapshot.windows.map((w) =>
      w.id === windowId ? { ...w, layout } : w,
    ),
  };
}

// ----- Integrity (load-time healing) -----

/**
 * Heal a snapshot into a valid state. Invariants, in order (each assumes the
 * ones before it):
 *
 *  1. a primary window exists;
 *  2. every window has a normalized layout (missing/empty → fresh leaf);
 *  3. layout leaves ↔ pane rows are a bijection per window — leaves without a
 *     row get one synthesized; rows without a leaf are removed with their tabs
 *     grafted onto the window's first pane (healing never deletes tabs);
 *  4. every tab's paneId resolves — else reassigned to the first pane of its
 *     window; if the window is dead too, the tab is dropped (matches the FK
 *     cascade);
 *  5. tab.windowId agrees with its pane's windowId;
 *  6. every pane has >= 1 tab (blank backfill);
 *  7. every pane's activeTabId exists in that pane — else its most recently
 *     active tab;
 *  8. every window's focusedPaneId is a live leaf — else the first one.
 *
 * Pure and returns the input snapshot identically when nothing needed fixing,
 * so the caller can save-if-changed.
 */
export function ensureSnapshotIntegrity(
  snapshot: TabsSnapshot,
  deps: { makeId: IdFactory; now: Clock },
): TabsSnapshot {
  const { makeId, now } = deps;
  let changed = false;

  // 1. Primary window.
  let windows = snapshot.windows;
  let panes = snapshot.panes;
  let tabs = snapshot.tabs;
  if (!windows.some((w) => w.isPrimary)) {
    changed = true;
    const windowId = makeId();
    const paneId = makeId();
    windows = [
      {
        id: windowId,
        isPrimary: true,
        bounds: null,
        layout: { type: "leaf", paneId },
        focusedPaneId: paneId,
      },
      ...windows,
    ];
    panes = [
      { id: paneId, windowId, activeTabId: null, createdAt: now() },
      ...panes,
    ];
  }

  // 2 + 3. Layout normalization and leaf<->pane bijection, per window.
  windows = windows.map((w) => {
    let layout = w.layout ? normalizeLayout(w.layout) : null;
    if (layout === null) {
      changed = true;
      const existing = panes.find((p) => p.windowId === w.id);
      const paneId = existing?.id ?? makeId();
      if (!existing) {
        panes = [
          ...panes,
          { id: paneId, windowId: w.id, activeTabId: null, createdAt: now() },
        ];
      }
      layout = { type: "leaf", paneId };
    } else if (layout !== w.layout) {
      changed = true;
    }

    const leafIds = collectLeafPaneIds(layout);
    // Leaves without a pane row → synthesize the row.
    for (const paneId of leafIds) {
      const pane = panes.find((p) => p.id === paneId);
      if (!pane) {
        changed = true;
        panes = [
          ...panes,
          { id: paneId, windowId: w.id, activeTabId: null, createdAt: now() },
        ];
      } else if (pane.windowId !== w.id) {
        changed = true;
        panes = panes.map((p) =>
          p.id === paneId ? { ...p, windowId: w.id } : p,
        );
      }
    }
    // Pane rows of this window not referenced by a leaf → graft tabs onto the
    // first pane, drop the row.
    const orphaned = panes.filter(
      (p) => p.windowId === w.id && !leafIds.includes(p.id),
    );
    if (orphaned.length > 0) {
      changed = true;
      const first = leafIds[0];
      const orphanIds = new Set(orphaned.map((p) => p.id));
      tabs = tabs.map((t) =>
        orphanIds.has(t.paneId) ? { ...t, paneId: first } : t,
      );
      panes = panes.filter((p) => !orphanIds.has(p.id));
    }

    return layout === w.layout ? w : { ...w, layout };
  });

  // 4 + 5. Tab pane/window agreement.
  const paneMap = new Map(panes.map((p) => [p.id, p]));
  const firstPaneOfWindow = (windowId: string): string | undefined => {
    const w = windows.find((x) => x.id === windowId);
    return w ? collectLeafPaneIds(w.layout)[0] : undefined;
  };
  tabs = tabs.flatMap((t) => {
    let pane = paneMap.get(t.paneId);
    if (!pane) {
      const fallback = firstPaneOfWindow(t.windowId);
      if (!fallback) {
        changed = true;
        return [];
      }
      changed = true;
      pane = paneMap.get(fallback);
      if (!pane) return [];
      t = { ...t, paneId: pane.id };
    }
    if (t.windowId !== pane.windowId) {
      changed = true;
      t = { ...t, windowId: pane.windowId };
    }
    return [t];
  });

  // 6. Every pane holds a tab. Built directly (not via newBlankTab) so the
  // backfill cannot steal window focus; step 7 makes it the pane's active tab.
  for (const pane of panes) {
    if (!tabs.some((t) => t.paneId === pane.id)) {
      changed = true;
      const ts = now();
      tabs = [
        ...tabs,
        {
          id: makeId(),
          windowId: pane.windowId,
          paneId: pane.id,
          dashboardId: null,
          taskId: null,
          channelId: null,
          channelSection: null,
          appView: null,
          position: POSITION_GAP,
          scrollState: null,
          createdAt: ts,
          lastActiveAt: ts,
        },
      ];
    }
  }

  // 7. Pane activeTabId validity.
  panes = panes.map((p) => {
    const valid =
      p.activeTabId != null &&
      tabs.some((t) => t.id === p.activeTabId && t.paneId === p.id);
    if (valid) return p;
    changed = true;
    const own = tabs
      .filter((t) => t.paneId === p.id)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return { ...p, activeTabId: own[0]?.id ?? null };
  });

  // 8. focusedPaneId validity.
  windows = windows.map((w) => {
    const leafIds = collectLeafPaneIds(w.layout);
    if (leafIds.includes(w.focusedPaneId)) return w;
    changed = true;
    return { ...w, focusedPaneId: leafIds[0] };
  });

  return changed ? { windows, panes, tabs } : snapshot;
}

// ----- Navigation intent (drives the renderer effect) -----

/**
 * What a navigation means for a pane's tab strip, given that pane's router
 * state. This is the decision the renderer makes on every location change in
 * a pane; extracted as a pure function so the UX rules are testable without a
 * router.
 *
 * - `activate`: the entry is tagged with a tab (a tab switch, or a back/forward
 *   replay landing on a tab) → focus that tab.
 * - `focusPane`: the route's identity is already open in ANOTHER pane → focus
 *   that pane and its tab instead of duplicating it here (two live mounts of
 *   the same task would double-attach its PTY).
 * - `replace`: an untagged navigation to a target (canvas or task) while a tab
 *   is active → swap the active tab's target in place (in-tab navigation), and
 *   stamp the entry.
 * - `open`: an untagged navigation to a target with no active tab → open one.
 * - `stamp`: an untagged navigation whose target already matches the active tab
 *   → nothing to change, just tag the entry so back/forward can replay it.
 * - `noop`: nothing to do (already on the right tab, or a blank/landing route).
 */
export type TabNavDecision =
  | { type: "activate"; tabId: string }
  | { type: "focusPane"; paneId: string; tabId: string }
  | {
      type: "replace";
      tabId: string;
      dashboardId: string | null;
      taskId: string | null;
      channelId: string | null;
      channelSection: string | null;
      appView: string | null;
      stampTabId: string | null;
    }
  | {
      type: "open";
      dashboardId: string | null;
      taskId: string | null;
      channelId: string | null;
      channelSection: string | null;
      appView: string | null;
      stampTabId: string | null;
    }
  | { type: "stamp"; stampTabId: string }
  | { type: "noop" };

export function decideTabNavigation(input: {
  /** tabId carried in the current history entry, if any. */
  historyTabId: string | null;
  /**
   * Ids of the tabs that currently exist in this pane. A history entry can
   * be tagged with a tab that has since been closed (back/forward replays the
   * entry); such a dead tag must NOT activate — it falls through and the route
   * decides (in-tab replace / open / stamp), which also re-stamps the entry
   * with a live tab. When omitted, tags are trusted (legacy behaviour).
   */
  paneTabIds?: readonly string[];
  /**
   * The pane's tabs with their identities. When a navigation's route matches
   * an existing tab that isn't the active one, we activate that tab instead of
   * replacing the active tab's target (which would duplicate it) or opening a
   * second copy. This also self-heals a rapid tab switch whose history stamp
   * was lost: it arrives looking like an in-tab nav, but the route still
   * identifies the intended tab, so we focus it rather than corrupt the active
   * tab. When omitted, this dedup is skipped (legacy behaviour).
   */
  paneTabs?: readonly (TabIdentity & { id: string })[];
  /**
   * Tabs living in the window's OTHER panes. When the route's identity is
   * already open in one of them, the decision is `focusPane` — window-level
   * dedup, so the same task never renders live in two panes at once. When
   * omitted, cross-pane dedup is skipped.
   */
  otherPanes?: readonly {
    paneId: string;
    tabs: readonly (TabIdentity & { id: string })[];
  }[];
  /** The pane's active tab id from the mirror (lags history). */
  paneActiveTabId: string | null;
  /** The active tab record, if one exists. */
  activeTab: {
    id: string;
    dashboardId: string | null;
    taskId: string | null;
    channelId?: string | null;
    channelSection?: string | null;
    appView?: string | null;
  } | null;
  /** Canvas in the current route, if any. */
  routeDashboardId: string | null;
  /** Task in the current route, if any. */
  routeTaskId: string | null;
  routeChannelId: string | null;
  /** Channel sub-section in the current route, if any. */
  routeChannelSection?: string | null;
  /** Top-level app page in the current route, if any. */
  routeAppView?: string | null;
}): TabNavDecision {
  const {
    historyTabId,
    paneActiveTabId,
    activeTab,
    routeDashboardId,
    routeTaskId,
    routeChannelId,
  } = input;
  const routeChannelSection = input.routeChannelSection ?? null;
  const routeAppView = input.routeAppView ?? null;

  // Tagged entry for a DIFFERENT tab → a tab switch or a back/forward replay.
  // Focus it (this is how "back returns to the previous tab" resolves). Two
  // guards: (1) the tagged tab must still exist in this pane — back/forward
  // can replay an entry whose tab was closed or moved to another pane, and
  // activating a dead id persists a dangling activeTabId (every nav then
  // opens a new tab); (2) when the tag equals the active tab we must NOT stop
  // here: an in-tab nav can arrive tagged with the active tab — fall through
  // and decide from the route.
  const historyTabIsLive =
    !!historyTabId &&
    (input.paneTabIds ? input.paneTabIds.includes(historyTabId) : true);
  if (historyTabId && historyTabIsLive && historyTabId !== paneActiveTabId) {
    return { type: "activate", tabId: historyTabId };
  }

  // Navigation within the active tab. A real target is a canvas, a task, or a
  // channel (home or sub-section); the landing/blank route (no channel) is a
  // noop.
  const routeIdentity: TabIdentity = {
    dashboardId: routeDashboardId,
    taskId: routeTaskId,
    channelId: routeChannelId,
    channelSection: routeChannelSection,
    appView: routeAppView,
  };
  if (!routeDashboardId && !routeTaskId && !routeChannelId && !routeAppView) {
    return { type: "noop" };
  }

  const activeMatchesRoute =
    !!activeTab &&
    sameIdentity(
      {
        dashboardId: activeTab.dashboardId,
        taskId: activeTab.taskId,
        channelId: activeTab.channelId ?? null,
        channelSection: activeTab.channelSection ?? null,
        appView: activeTab.appView ?? null,
      },
      routeIdentity,
    );

  // A blank active tab is a fresh `+` tab waiting for its first target: the
  // navigation is "fill me", never a switch — so the dedup below must not
  // steal it (activating another tab would strand the blank forever).
  const activeIsBlank = !!activeTab && isBlankIdentity(activeTab);

  if (!activeMatchesRoute && !activeIsBlank) {
    // The route already lives in another tab of THIS pane → focus it instead
    // of replacing the active tab's target (which would leave two tabs on the
    // same identity) or opening a duplicate. Also recovers a rapid switch
    // whose history tag was lost: the intended tab is still identified by the
    // route. Only when the active tab does NOT already show the route —
    // otherwise, if a duplicate tab already exists, we'd bounce between the
    // two identical tabs forever.
    const existingMatch = input.paneTabs?.find(
      (t) => t.id !== activeTab?.id && sameIdentity(t, routeIdentity),
    );
    if (existingMatch) {
      return { type: "activate", tabId: existingMatch.id };
    }
    // ...or in ANOTHER pane → focus that pane (window-level dedup).
    for (const other of input.otherPanes ?? []) {
      const match = other.tabs.find((t) => sameIdentity(t, routeIdentity));
      if (match) {
        return { type: "focusPane", paneId: other.paneId, tabId: match.id };
      }
    }
  }

  if (activeTab && !activeMatchesRoute) {
    return {
      type: "replace",
      tabId: activeTab.id,
      dashboardId: routeDashboardId,
      taskId: routeTaskId,
      channelId: routeChannelId,
      channelSection: routeChannelSection,
      appView: routeAppView,
      stampTabId: paneActiveTabId,
    };
  }
  if (!activeTab) {
    return {
      type: "open",
      dashboardId: routeDashboardId,
      taskId: routeTaskId,
      channelId: routeChannelId,
      channelSection: routeChannelSection,
      appView: routeAppView,
      stampTabId: paneActiveTabId,
    };
  }
  // Active tab already shows this target — just tag the entry.
  return paneActiveTabId
    ? { type: "stamp", stampTabId: paneActiveTabId }
    : { type: "noop" };
}
