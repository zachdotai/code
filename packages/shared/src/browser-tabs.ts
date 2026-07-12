import {
  collectLeafPaneIds,
  insertNodeInLayout,
  insertPaneInLayout,
  normalizeLayout,
  removePaneFromLayout,
  setSplitSizesAtPath,
} from "./browser-pane-layout";
import type {
  BrowserPane,
  BrowserTab,
  PaneLayoutNode,
  SplitDropDirection,
  TabsSnapshot,
} from "./browser-tabs-schemas";

/**
 * Pure snapshot transforms for the v2 tab model: window → tabs → panes.
 * A tab is a strip unit owning a pane layout; a pane is a content unit
 * carrying the identity (canvas / task / channel / app view). Layout tree
 * geometry lives in `browser-pane-layout.ts`; this module moves rows and
 * focus around it.
 */

/** Spacing between adjacent tab positions, leaving room to insert without reindex. */
export const POSITION_GAP = 1000;

type Clock = () => number;
type IdFactory = () => string;

export type OpenTabResult = {
  snapshot: TabsSnapshot;
  tabId: string;
  /** The pane showing the target (the new tab's pane, or the deduped one). */
  paneId: string;
  /** False when an existing pane was focused (dedup) rather than created. */
  opened: boolean;
};

export type CloseTabResult = {
  snapshot: TabsSnapshot;
  /** Tab focused after the close, or null for the channels landing. */
  nextActiveTabId: string | null;
  /** Set when closing the last tab of a secondary window should close it. */
  closedWindowId: string | null;
};

/**
 * Everything that identifies a pane's contents: a canvas, a task, a channel
 * sub-section (channel + section), or a top-level app page. Two panes with the
 * same identity are the same page, so dedup and in-pane-nav comparisons key on
 * all five — a channel's `history` and `artifacts`, or two channels'
 * artifacts, are distinct pages.
 */
export type PaneIdentity = {
  dashboardId: string | null;
  taskId: string | null;
  channelId: string | null;
  channelSection: string | null;
  appView: string | null;
};

export const BLANK_PANE_IDENTITY: PaneIdentity = {
  dashboardId: null,
  taskId: null,
  channelId: null,
  channelSection: null,
  appView: null,
};

export function paneIdentityOf(pane: {
  dashboardId: string | null;
  taskId: string | null;
  channelId?: string | null;
  channelSection?: string | null;
  appView?: string | null;
}): PaneIdentity {
  return {
    dashboardId: pane.dashboardId,
    taskId: pane.taskId,
    channelId: pane.channelId ?? null,
    channelSection: pane.channelSection ?? null,
    appView: pane.appView ?? null,
  };
}

export function samePaneIdentity(a: PaneIdentity, b: PaneIdentity): boolean {
  return (
    a.dashboardId === b.dashboardId &&
    a.taskId === b.taskId &&
    a.channelId === b.channelId &&
    a.channelSection === b.channelSection &&
    a.appView === b.appView
  );
}

/** A blank pane is a fresh `+` target: no canvas, task, channel, or app page. */
export function paneIsBlank(identity: PaneIdentity): boolean {
  return samePaneIdentity(identity, BLANK_PANE_IDENTITY);
}

function tabsInWindow(snapshot: TabsSnapshot, windowId: string): BrowserTab[] {
  return snapshot.tabs
    .filter((t) => t.windowId === windowId)
    .sort((a, b) => a.position - b.position);
}

/** The primary window, falling back to the first one (web has a single window). */
export function primaryWindow(snapshot: TabsSnapshot) {
  return snapshot.windows.find((w) => w.isPrimary) ?? snapshot.windows[0];
}

/** A tab's panes in layout (depth-first display) order. */
export function tabPanes(snapshot: TabsSnapshot, tabId: string): BrowserPane[] {
  const tab = snapshot.tabs.find((t) => t.id === tabId);
  if (!tab) return [];
  const byId = new Map(
    snapshot.panes.filter((p) => p.tabId === tabId).map((p) => [p.id, p]),
  );
  return collectLeafPaneIds(tab.layout)
    .map((id) => byId.get(id))
    .filter((p): p is BrowserPane => p !== undefined);
}

/** The pane a tab's pill and default navigation act on. Null only pre-heal. */
export function focusedPaneOfTab(
  snapshot: TabsSnapshot,
  tab: BrowserTab,
): BrowserPane | null {
  return (
    snapshot.panes.find(
      (p) => p.id === tab.focusedPaneId && p.tabId === tab.id,
    ) ?? null
  );
}

/**
 * True when the primary window's active tab is showing a blank focused pane:
 * no canvas, task, or channel. The blank pane parks at the channels index
 * (`/website`), whose route would otherwise redirect to the first channel —
 * callers use this to suppress that redirect so the blank pane (and the
 * in-flight navigation leaving it) isn't hijacked to `channels[0]`.
 */
export function activeTabIsBlank(snapshot: TabsSnapshot): boolean {
  const w = primaryWindow(snapshot);
  if (!w?.activeTabId) return false;
  const t = snapshot.tabs.find((x) => x.id === w.activeTabId);
  if (!t) return false;
  const pane = focusedPaneOfTab(snapshot, t);
  return !!pane && paneIsBlank(paneIdentityOf(pane));
}

/**
 * True when the primary window has no tabs at all — the user closed every tab.
 * The channels index renders the new-tab screen for this state rather than
 * redirecting to the first channel, which would silently re-open a tab.
 */
export function primaryWindowHasNoTabs(snapshot: TabsSnapshot): boolean {
  const w = primaryWindow(snapshot);
  if (!w) return false;
  return !snapshot.tabs.some((t) => t.windowId === w.id);
}

function setActiveTab(
  snapshot: TabsSnapshot,
  windowId: string,
  tabId: string | null,
): TabsSnapshot {
  return {
    ...snapshot,
    windows: snapshot.windows.map((w) =>
      w.id === windowId ? { ...w, activeTabId: tabId } : w,
    ),
  };
}

/**
 * Focus a tab in a window, validating the target: the tab must exist and live
 * in that window, otherwise the snapshot is returned unchanged. A `null` tabId
 * clears focus (the landing state). This is the persistence-safe primitive —
 * a desynced mirror can carry ids of tabs closed since, and blindly persisting
 * such an id leaves the window with a dangling activeTabId, after which every
 * navigation looks like "no active tab" and opens a new tab.
 */
export function setWindowActiveTab(
  snapshot: TabsSnapshot,
  windowId: string,
  tabId: string | null,
): TabsSnapshot {
  if (tabId !== null) {
    const tab = snapshot.tabs.find((t) => t.id === tabId);
    if (!tab || tab.windowId !== windowId) return snapshot;
  }
  const window = snapshot.windows.find((w) => w.id === windowId);
  if (!window || window.activeTabId === tabId) return snapshot;
  return setActiveTab(snapshot, windowId, tabId);
}

/**
 * Focus a pane within its tab. Validated: the pane must exist and belong to
 * `tabId`, else the snapshot is returned unchanged.
 */
export function setFocusedPane(
  snapshot: TabsSnapshot,
  tabId: string,
  paneId: string,
): TabsSnapshot {
  const pane = snapshot.panes.find((p) => p.id === paneId);
  if (!pane || pane.tabId !== tabId) return snapshot;
  const tab = snapshot.tabs.find((t) => t.id === tabId);
  if (!tab || tab.focusedPaneId === paneId) return snapshot;
  return {
    ...snapshot,
    tabs: snapshot.tabs.map((t) =>
      t.id === tabId ? { ...t, focusedPaneId: paneId } : t,
    ),
  };
}

/**
 * Open a target in a window, deduping across every pane in that window: if a
 * pane already shows the same identity, its tab is activated and the pane
 * focused; otherwise a new single-pane tab is appended. Duplicates across
 * different windows are allowed. `tabId`/`paneId` let the renderer mint the
 * ids so an optimistic local apply and the persisted state agree.
 */
export function openOrFocusTab(
  snapshot: TabsSnapshot,
  input: PaneIdentity & {
    windowId: string;
    tabId?: string;
    paneId?: string;
    makeId: IdFactory;
    now: Clock;
  },
): OpenTabResult {
  const { windowId, makeId, now } = input;
  const identity = paneIdentityOf(input);
  const existing = snapshot.panes.find(
    (p) =>
      p.windowId === windowId && samePaneIdentity(paneIdentityOf(p), identity),
  );
  if (existing) {
    const ts = now();
    const withActivity: TabsSnapshot = {
      ...snapshot,
      panes: snapshot.panes.map((p) =>
        p.id === existing.id ? { ...p, lastActiveAt: ts } : p,
      ),
      tabs: snapshot.tabs.map((t) =>
        t.id === existing.tabId
          ? { ...t, focusedPaneId: existing.id, lastActiveAt: ts }
          : t,
      ),
    };
    return {
      snapshot: setActiveTab(withActivity, windowId, existing.tabId),
      tabId: existing.tabId,
      paneId: existing.id,
      opened: false,
    };
  }

  return appendTab(snapshot, {
    windowId,
    identity,
    tabId: input.tabId,
    paneId: input.paneId,
    makeId,
    now,
  });
}

function appendTab(
  snapshot: TabsSnapshot,
  input: {
    windowId: string;
    identity: PaneIdentity;
    tabId?: string;
    paneId?: string;
    makeId: IdFactory;
    now: Clock;
  },
): OpenTabResult {
  const { windowId, identity, makeId, now } = input;
  const siblings = tabsInWindow(snapshot, windowId);
  const lastPos = siblings.length ? siblings[siblings.length - 1].position : 0;
  const ts = now();
  const paneId = input.paneId ?? makeId();
  const tabId = input.tabId ?? makeId();
  const pane: BrowserPane = {
    id: paneId,
    tabId,
    windowId,
    ...identity,
    scrollState: null,
    createdAt: ts,
    lastActiveAt: ts,
  };
  const tab: BrowserTab = {
    id: tabId,
    windowId,
    layout: { type: "leaf", paneId },
    focusedPaneId: paneId,
    position: lastPos + POSITION_GAP,
    createdAt: ts,
    lastActiveAt: ts,
  };
  const withTab: TabsSnapshot = {
    ...snapshot,
    tabs: [...snapshot.tabs, tab],
    panes: [...snapshot.panes, pane],
  };
  return {
    snapshot: setActiveTab(withTab, windowId, tabId),
    tabId,
    paneId,
    opened: true,
  };
}

/**
 * Append a blank tab (single blank pane) and focus it. The strip shows it as
 * an empty placeholder; navigating while it is active fills it via
 * {@link setPaneTarget}.
 */
export function newBlankTab(
  snapshot: TabsSnapshot,
  input: {
    windowId: string;
    tabId?: string;
    paneId?: string;
    makeId: IdFactory;
    now: Clock;
  },
): OpenTabResult {
  return appendTab(snapshot, {
    windowId: input.windowId,
    identity: BLANK_PANE_IDENTITY,
    tabId: input.tabId,
    paneId: input.paneId,
    makeId: input.makeId,
    now: input.now,
  });
}

/**
 * Point an existing pane at a target — the in-pane navigation primitive. Used
 * when a pane's router location changes, so the target replaces the pane's
 * contents instead of opening a new tab. Also focuses the pane within its tab
 * and activates the tab (a navigating pane is by construction in the active,
 * rendered tab; re-asserting both heals any drift).
 */
export function setPaneTarget(
  snapshot: TabsSnapshot,
  input: PaneIdentity & { paneId: string; now: Clock },
): TabsSnapshot {
  const pane = snapshot.panes.find((p) => p.id === input.paneId);
  if (!pane) return snapshot;
  const identity = paneIdentityOf(input);
  const ts = input.now();
  const withTarget: TabsSnapshot = {
    ...snapshot,
    panes: snapshot.panes.map((p) =>
      p.id === input.paneId ? { ...p, ...identity, lastActiveAt: ts } : p,
    ),
    tabs: snapshot.tabs.map((t) =>
      t.id === pane.tabId
        ? { ...t, focusedPaneId: pane.id, lastActiveAt: ts }
        : t,
    ),
  };
  return setWindowActiveTab(withTarget, pane.windowId, pane.tabId);
}

/**
 * Close a tab (all its panes). Focus moves to the nearest sibling. Closing the
 * last tab of a secondary window signals that the window should close; closing
 * the last tab of the primary window backfills a fresh blank tab so the strip
 * is never empty. `blankTabId`/`blankPaneId` let the renderer mint the
 * backfill ids for optimistic-apply agreement.
 */
export function closeTab(
  snapshot: TabsSnapshot,
  tabId: string,
  deps: {
    makeId: IdFactory;
    now: Clock;
    blankTabId?: string;
    blankPaneId?: string;
  },
): CloseTabResult {
  const tab = snapshot.tabs.find((t) => t.id === tabId);
  if (!tab) {
    return { snapshot, nextActiveTabId: null, closedWindowId: null };
  }
  const window = snapshot.windows.find((w) => w.id === tab.windowId);
  const siblings = tabsInWindow(snapshot, tab.windowId);
  const idx = siblings.findIndex((t) => t.id === tabId);
  const remaining = siblings.filter((t) => t.id !== tabId);

  const removed: TabsSnapshot = {
    ...snapshot,
    tabs: snapshot.tabs.filter((t) => t.id !== tabId),
    panes: snapshot.panes.filter((p) => p.tabId !== tabId),
  };

  if (remaining.length === 0) {
    if (window && !window.isPrimary) {
      // Drop the window too.
      return {
        snapshot: {
          ...removed,
          windows: snapshot.windows.filter((w) => w.id !== tab.windowId),
        },
        nextActiveTabId: null,
        closedWindowId: tab.windowId,
      };
    }
    // Primary window → never-empty strip: backfill a blank tab.
    const backfilled = newBlankTab(removed, {
      windowId: tab.windowId,
      tabId: deps.blankTabId,
      paneId: deps.blankPaneId,
      makeId: deps.makeId,
      now: deps.now,
    });
    return {
      snapshot: backfilled.snapshot,
      nextActiveTabId: backfilled.tabId,
      closedWindowId: null,
    };
  }

  // Focus the tab that took the closed slot, else the new last one.
  const next = remaining[Math.min(idx, remaining.length - 1)];
  const wasActive = window?.activeTabId === tabId;
  return {
    snapshot: wasActive
      ? setActiveTab(removed, tab.windowId, next.id)
      : removed,
    nextActiveTabId: wasActive ? next.id : (window?.activeTabId ?? null),
    closedWindowId: null,
  };
}

/**
 * Close several tabs at once — the bulk primitive behind "close other tabs" /
 * "close tabs to the right/left". Composes {@link closeTab} so the per-window
 * succession rules (survivor focus, secondary-window drop, primary backfill)
 * live in exactly one place.
 *
 * `focusTabId` is the bulk close's anchor (the right-clicked tab, which always
 * survives these operations). When a window's active tab is among those closed,
 * focus moves to the anchor rather than closeTab's stored-order neighbour — the
 * caller closes by *displayed* (pinned-first) order, so the stored-order
 * neighbour can be a pinned tab at the far end of the strip.
 */
export function closeTabs(
  snapshot: TabsSnapshot,
  tabIds: string[],
  focusTabId: string | null | undefined,
  deps: { makeId: IdFactory; now: Clock },
): TabsSnapshot {
  const ids = new Set(tabIds);
  if (ids.size === 0) return snapshot;

  // Windows whose active tab is being closed — only these honour the anchor.
  const activeClosedWindows = new Set(
    snapshot.windows
      .filter((w) => w.activeTabId != null && ids.has(w.activeTabId))
      .map((w) => w.id),
  );

  let next = snapshot;
  for (const id of ids) {
    next = closeTab(next, id, deps).snapshot;
  }

  if (focusTabId) {
    const anchor = next.tabs.find((t) => t.id === focusTabId);
    if (anchor && activeClosedWindows.has(anchor.windowId)) {
      next = setActiveTab(next, anchor.windowId, focusTabId);
    }
  }
  return next;
}

/**
 * Remove a pane from its tab's layout (the hover close-X on a pane). The
 * tab survives with its remaining panes; focus moves to the first remaining
 * leaf when the closed pane was focused. No-op when the pane is the tab's
 * only one (close the tab instead — the UI hides the X then).
 */
export function closePane(
  snapshot: TabsSnapshot,
  tabId: string,
  paneId: string,
): TabsSnapshot {
  const tab = snapshot.tabs.find((t) => t.id === tabId);
  const pane = snapshot.panes.find((p) => p.id === paneId);
  if (!tab || !pane || pane.tabId !== tabId) return snapshot;
  const layout = removePaneFromLayout(tab.layout, paneId);
  if (layout === null || layout === tab.layout) return snapshot;
  const focusedPaneId =
    tab.focusedPaneId === paneId
      ? collectLeafPaneIds(layout)[0]
      : tab.focusedPaneId;
  return {
    ...snapshot,
    tabs: snapshot.tabs.map((t) =>
      t.id === tabId ? { ...t, layout, focusedPaneId } : t,
    ),
    panes: snapshot.panes.filter((p) => p.id !== paneId),
  };
}

/**
 * Merge one tab's panes into another as a split — the drop primitive for
 * dragging a pill onto the content area. The source tab's whole layout
 * subtree is spliced next to `targetPaneId` (or the layout root when null)
 * on the `direction` side; the source tab disappears from the strip and the
 * target tab gains its panes, with focus landing on the source's focused
 * pane. No-op when source and target are the same tab, live in different
 * windows, or either is missing.
 */
export function mergeTabIntoTab(
  snapshot: TabsSnapshot,
  input: {
    windowId: string;
    sourceTabId: string;
    targetTabId: string;
    targetPaneId: string | null;
    direction: SplitDropDirection;
    now: Clock;
  },
): TabsSnapshot {
  const { windowId, sourceTabId, targetTabId, targetPaneId, direction } = input;
  if (sourceTabId === targetTabId) return snapshot;
  const source = snapshot.tabs.find((t) => t.id === sourceTabId);
  const target = snapshot.tabs.find((t) => t.id === targetTabId);
  if (!source || !target) return snapshot;
  if (source.windowId !== windowId || target.windowId !== windowId) {
    return snapshot;
  }
  if (
    targetPaneId !== null &&
    !collectLeafPaneIds(target.layout).includes(targetPaneId)
  ) {
    return snapshot;
  }
  const layout = insertNodeInLayout(
    target.layout,
    targetPaneId,
    direction,
    source.layout,
  );
  if (layout === target.layout) return snapshot;
  const ts = input.now();
  const merged: TabsSnapshot = {
    ...snapshot,
    tabs: snapshot.tabs
      .filter((t) => t.id !== sourceTabId)
      .map((t) =>
        t.id === targetTabId
          ? {
              ...t,
              layout,
              focusedPaneId: source.focusedPaneId,
              lastActiveAt: ts,
            }
          : t,
      ),
    panes: snapshot.panes.map((p) =>
      p.tabId === sourceTabId ? { ...p, tabId: targetTabId } : p,
    ),
  };
  return setActiveTab(merged, windowId, targetTabId);
}

/**
 * Persist a window's full tab order — the drop primitive for drag-to-reorder.
 * The UI sends the final stored order (pin-agnostic; the pinned-first display
 * partition is applied on top at render time) and it becomes the stored order.
 * Ids not in the window are ignored; the window's tabs missing from the list
 * keep their relative order after the listed ones. Tabs whose position does not
 * change keep their object identity so downstream memos/effects stay stable.
 */
export function setTabOrder(
  snapshot: TabsSnapshot,
  windowId: string,
  orderedTabIds: string[],
): TabsSnapshot {
  const current = tabsInWindow(snapshot, windowId);
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

/**
 * Set the sizes of a split in a tab's layout, addressed by child-index path
 * (the resize-gesture commit). Validation lives in `setSplitSizesAtPath`; an
 * invalid path or sizes leaves the snapshot unchanged.
 */
export function setPaneSizes(
  snapshot: TabsSnapshot,
  tabId: string,
  path: number[],
  sizes: number[],
): TabsSnapshot {
  const tab = snapshot.tabs.find((t) => t.id === tabId);
  if (!tab) return snapshot;
  const layout = setSplitSizesAtPath(tab.layout, path, sizes);
  if (layout === tab.layout) return snapshot;
  return {
    ...snapshot,
    tabs: snapshot.tabs.map((t) => (t.id === tabId ? { ...t, layout } : t)),
  };
}

// ----- Snapshot healing -----

/**
 * Heal a snapshot into the invariants every transform assumes. Applied on
 * load (and after any remote write) so one bad row can't wedge the strip:
 *
 * - a primary window exists;
 * - every tab lives in an existing window (orphans move to the primary);
 * - every pane belongs to an existing tab (orphans are dropped) and agrees
 *   with its tab's window;
 * - every tab's layout is canonical, and its leaves biject with the tab's
 *   pane rows (unknown leaves are pruned, unlisted panes grafted in, a
 *   paneless tab gets a fresh blank pane);
 * - every tab's `focusedPaneId` is one of its leaves;
 * - every window holds >= 1 tab (the primary is backfilled with a blank tab;
 *   an empty secondary window is dropped) and its `activeTabId` is one of
 *   its tabs;
 * - tab positions within a window are unique (stable reindex on collision).
 *
 * Returns the same reference when nothing needed healing — callers use that
 * to decide whether to re-persist.
 */
export function ensureSnapshotIntegrity(
  snapshot: TabsSnapshot,
  deps: { makeId: IdFactory; now: Clock },
): TabsSnapshot {
  const { makeId, now } = deps;
  let changed = false;

  // Primary window exists.
  let windows = snapshot.windows;
  if (!windows.some((w) => w.isPrimary)) {
    changed = true;
    windows =
      windows.length > 0
        ? windows.map((w, i) => (i === 0 ? { ...w, isPrimary: true } : w))
        : [
            {
              id: makeId(),
              isPrimary: true,
              bounds: null,
              activeTabId: null,
            },
          ];
  }
  const windowIds = new Set(windows.map((w) => w.id));
  const primaryId = windows.find((w) => w.isPrimary)?.id ?? windows[0].id;

  // Tabs live in existing windows.
  let tabs = snapshot.tabs;
  if (tabs.some((t) => !windowIds.has(t.windowId))) {
    changed = true;
    tabs = tabs.map((t) =>
      windowIds.has(t.windowId) ? t : { ...t, windowId: primaryId },
    );
  }
  const tabById = new Map(tabs.map((t) => [t.id, t]));

  // Panes belong to existing tabs (orphans drop) and agree with the tab's
  // window.
  let panes = snapshot.panes;
  {
    let panesChanged = false;
    const healed: BrowserPane[] = [];
    for (const p of panes) {
      const tab = tabById.get(p.tabId);
      if (!tab) {
        panesChanged = true;
        continue;
      }
      if (tab.windowId !== p.windowId) {
        panesChanged = true;
        healed.push({ ...p, windowId: tab.windowId });
      } else {
        healed.push(p);
      }
    }
    if (panesChanged) {
      changed = true;
      panes = healed;
    }
  }

  // Per tab: canonical layout, leaf↔pane bijection, valid focused pane.
  const panesByTab = new Map<string, BrowserPane[]>();
  for (const p of panes) {
    const list = panesByTab.get(p.tabId);
    if (list) list.push(p);
    else panesByTab.set(p.tabId, [p]);
  }
  const extraPanes: BrowserPane[] = [];
  tabs = tabs.map((tab) => {
    const own = panesByTab.get(tab.id) ?? [];
    const ownIds = new Set(own.map((p) => p.id));

    // Prune leaves without a pane row, then canonicalise.
    let layout: PaneLayoutNode | null = tab.layout;
    for (const leafId of collectLeafPaneIds(tab.layout)) {
      if (!ownIds.has(leafId) && layout !== null) {
        layout = removePaneFromLayout(layout, leafId);
      }
    }
    layout = layout === null ? null : normalizeLayout(layout);

    // Graft pane rows missing from the layout.
    const leafIds = new Set(layout ? collectLeafPaneIds(layout) : []);
    for (const p of own) {
      if (leafIds.has(p.id)) continue;
      layout =
        layout === null
          ? { type: "leaf", paneId: p.id }
          : insertPaneInLayout(layout, null, "right", p.id);
      leafIds.add(p.id);
    }

    // A tab with no panes at all gets a fresh blank one.
    if (layout === null) {
      const ts = now();
      const pane: BrowserPane = {
        id: makeId(),
        tabId: tab.id,
        windowId: tab.windowId,
        ...BLANK_PANE_IDENTITY,
        scrollState: null,
        createdAt: ts,
        lastActiveAt: ts,
      };
      extraPanes.push(pane);
      layout = { type: "leaf", paneId: pane.id };
      leafIds.add(pane.id);
    }

    const focusedPaneId = leafIds.has(tab.focusedPaneId)
      ? tab.focusedPaneId
      : collectLeafPaneIds(layout)[0];

    if (layout === tab.layout && focusedPaneId === tab.focusedPaneId) {
      return tab;
    }
    changed = true;
    return { ...tab, layout, focusedPaneId };
  });
  if (extraPanes.length > 0) {
    changed = true;
    panes = [...panes, ...extraPanes];
  }

  // Windows hold >= 1 tab; empty secondaries drop, the primary backfills.
  const tabsOf = (windowId: string) =>
    tabs.filter((t) => t.windowId === windowId);
  const emptySecondaries = windows.filter(
    (w) => !w.isPrimary && tabsOf(w.id).length === 0,
  );
  if (emptySecondaries.length > 0) {
    changed = true;
    const dead = new Set(emptySecondaries.map((w) => w.id));
    windows = windows.filter((w) => !dead.has(w.id));
  }
  if (tabsOf(primaryId).length === 0) {
    changed = true;
    const ts = now();
    const paneId = makeId();
    const tabId = makeId();
    panes = [
      ...panes,
      {
        id: paneId,
        tabId,
        windowId: primaryId,
        ...BLANK_PANE_IDENTITY,
        scrollState: null,
        createdAt: ts,
        lastActiveAt: ts,
      },
    ];
    tabs = [
      ...tabs,
      {
        id: tabId,
        windowId: primaryId,
        layout: { type: "leaf", paneId },
        focusedPaneId: paneId,
        position: POSITION_GAP,
        createdAt: ts,
        lastActiveAt: ts,
      },
    ];
  }

  // Valid activeTabId per window (fall back to the most recently active tab).
  windows = windows.map((w) => {
    const own = tabsOf(w.id);
    if (w.activeTabId && own.some((t) => t.id === w.activeTabId)) return w;
    const fallback = [...own].sort(
      (a, b) => b.lastActiveAt - a.lastActiveAt,
    )[0];
    const activeTabId = fallback ? fallback.id : null;
    if (activeTabId === w.activeTabId) return w;
    changed = true;
    return { ...w, activeTabId };
  });

  // Unique tab positions per window (stable reindex on collision).
  for (const w of windows) {
    const own = tabsOf(w.id);
    const positions = new Set(own.map((t) => t.position));
    if (positions.size === own.length) continue;
    changed = true;
    const reindexed = new Map(
      [...own]
        .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt)
        .map((t, i) => [t.id, (i + 1) * POSITION_GAP]),
    );
    tabs = tabs.map((t) => {
      const pos = reindexed.get(t.id);
      return pos === undefined || pos === t.position
        ? t
        : { ...t, position: pos };
    });
  }

  return changed ? { windows, tabs, panes } : snapshot;
}

// ----- Navigation intent (drives the per-pane renderer effect) -----

/** History action reported by the pane router for the navigation. */
export type PaneHistoryAction =
  | "PUSH"
  | "REPLACE"
  | "BACK"
  | "FORWARD"
  | "GO"
  | null;

/**
 * What a pane's location change means for the tab system. This is the decision
 * a pane's reconcile effect makes on every location change; extracted as a
 * pure function so the UX rules are testable without a router.
 *
 * - `noop`: nothing to do — the route is blank/landing, or the pane already
 *   shows it.
 * - `activateTab`: the route's identity is already open in another pane of
 *   this window → focus that pane's tab instead of duplicating the page.
 *   Only on PUSH navigations (fresh user intent): back/forward replays a
 *   pane's own history and must never be hijacked to another tab. Never when
 *   this pane is blank — a blank pane's first navigation is "fill me".
 * - `replacePane`: an ordinary in-pane navigation → point the pane at the
 *   route's identity (`setPaneTarget`).
 */
export type PaneNavDecision =
  | { type: "noop" }
  | { type: "activateTab"; tabId: string; paneId: string }
  | { type: "replacePane" };

export function decidePaneNavigation(input: {
  /** The pane's current identity (from the snapshot mirror). */
  paneIdentity: PaneIdentity;
  /** Identity the pane's router location resolves to. */
  routeIdentity: PaneIdentity;
  /** Every other pane in the window (any tab), with its owner tab. */
  otherOpenPanes: readonly {
    tabId: string;
    paneId: string;
    identity: PaneIdentity;
  }[];
  historyAction: PaneHistoryAction;
}): PaneNavDecision {
  const { paneIdentity, routeIdentity, otherOpenPanes, historyAction } = input;

  // The landing/blank route points at nothing — leave the pane as it is.
  if (paneIsBlank(routeIdentity)) return { type: "noop" };
  if (samePaneIdentity(paneIdentity, routeIdentity)) return { type: "noop" };

  // Dedup: the page already lives in another pane → focus it there. PUSH
  // only — back/forward replays this pane's own history and must not be
  // hijacked — and never from a blank pane, whose first navigation fills it.
  if (historyAction === "PUSH" && !paneIsBlank(paneIdentity)) {
    const existing = otherOpenPanes.find((p) =>
      samePaneIdentity(p.identity, routeIdentity),
    );
    if (existing) {
      return {
        type: "activateTab",
        tabId: existing.tabId,
        paneId: existing.paneId,
      };
    }
  }

  return { type: "replacePane" };
}
