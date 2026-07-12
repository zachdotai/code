# Browser tabs (Channels canvas surface)

A browser-style tab strip in the title bar. **Each tab OWNS a split-pane
layout** (Chrome split-view model): the strip pill is the whole tab; the tab's
`layout` is a `PaneLayoutNode` tree whose leaves are **panes**, and panes carry
the identity — an open **canvas, task, channel sub-section, app page, or
blank** (`PaneIdentity`: `dashboardId | taskId | channel(+section) | appView |
blank`). The common single-pane tab is a bare-leaf layout. A multi-pane tab's
pill swaps its content icon for a **layout glyph** (`PaneLayoutGlyph`, a mini
SVG of the actual tree). This file documents the UX and the model; edit it when
the behaviour changes.

Canvases and tasks are equal citizens: navigating to either inside a pane
replaces that pane's identity in place (`setPaneTarget`), the label resolves
from the canvas name or the task title. Channel sub-sections work the same
(identity differs by `channelSection`); the tab labels by its FOCUSED pane's
identity.

## Model

```
window { activeTabId }            — which tab the strip shows
tab    { layout, focusedPaneId }  — strip unit; owns a pane tree
pane   { tabId, identity… }       — content unit; one router each
```

- **One router per pane** (`createAppRouter`): memory history over the shared
  route tree, cached in `paneRouterRegistry` keyed by paneId. Inactive tabs'
  panes unmount but their routers stay cached, so locations survive tab
  switches. Every navigation writes the pane's href to sessionStorage
  (`paneLocationPersistence`) for Cmd+R/HMR restore; across relaunches the
  identity on the pane row is the source of truth (`hrefForIdentity`).
- **A pane's location IS its content pointer.** `PaneChrome` (the root route,
  mounted once per pane) runs `decidePaneNavigation` on every location change:
  `replacePane` → `setPaneTarget` (the ordinary case); `activateTab` → a PUSH
  navigation to a page already open in another pane focuses that pane's tab
  instead of duplicating (never on back/forward, never from a blank pane);
  `noop` for blank/landing routes. There is **no history tabId-stamping** —
  that whole v1 mechanism is gone.
- **Tab switches are pure store mutations** (`setWindowActiveTab`), NOT
  navigations — browser-like: back/forward move within a pane's own history
  and never replay tab switches. The title-bar `< >` buttons follow the
  FOCUSED pane (active tab's `focusedPaneId`) via `usePaneHistoryControls` +
  the per-router forward tracker.
- **Chrome lives outside the route tree** (`shell/AppShell.tsx`): title bar
  (strip, back/forward, usage, PostHog Web), sidebar, global modals, deep
  links. It wraps everything in a `RouterContextProvider` bound to the focused
  pane's router (`useFocusedPaneRouter`), so chrome hooks (useAppView, Link,
  navigate) target the focused pane automatically. `App.tsx` boots the active
  tab's focused pane's router, then renders `AppShell → PaneTreeRenderer`.

## Where the logic lives

- **`@posthog/shared`** (`browser-tabs.ts`, `browser-pane-layout.ts`,
  `browser-tabs-schemas.ts`) — pure, host-neutral logic: the domain shapes,
  the layout tree math (`insertNodeInLayout`/`insertPaneInLayout`,
  `removePaneFromLayout`, `setSplitSizesAtPath`, `normalizeLayout` — canonical
  form: n-ary splits, sizes sum to 1, no same-direction nesting), the
  transforms (`openOrFocusTab` window-wide pane dedup, `newBlankTab`,
  `setPaneTarget`, `setWindowActiveTab`, `setFocusedPane`, `closeTab`,
  `closeTabs`, `closePane`, `mergeTabIntoTab`, `setTabOrder`, `setPaneSizes`),
  `ensureSnapshotIntegrity` (boot healing: primary window, ≥1 tab, layout↔pane
  bijection, valid focus/active ids, position de-collision), and
  `decidePaneNavigation`. No React, no I/O. Behaviour is unit-tested here.
- **`@posthog/workspace-server`** (`services/browser-tabs/`, `db/`) — the
  authoritative single-instance `BrowserTabsService` in the main process. Owns
  the durable snapshot in sqlite (`browser_windows` / `browser_tabs` /
  `browser_panes`), applies the shared transforms, heals with
  `ensureSnapshotIntegrity` at boot, and emits `snapshotChange` for
  cross-window fan-out. The repo persists the whole snapshot as a
  transactional full replace; a corrupt tab `layout` degrades to a leaf and
  heals.
- **host-router** (`routers/browser-tabs.router.ts`) — one-line forwards.
- **`@posthog/core`** (`browser-tabs/browserTabsStore.ts`) — renderer mirror.
- **this folder (`@posthog/ui`)** — `BrowserTabStrip` (title-bar container),
  `TabStrip` (presentational), `PaneLayoutGlyph`, `panes/` (`PaneTreeRenderer`
  renders the ACTIVE tab's layout with `react-resizable-panels`;
  `BrowserPane` = router + focus ring + pointerdown focus; `PaneDropZones` /
  `RootDropZones` merge drops; `paneDragStore` transient drag state),
  `BlankTabView`, `TaskTabIcon`, the client facade, the boot contribution, and
  **`tabsSync.ts` — the local-first sync policy**: every operation applies its
  shared pure transform to the renderer mirror synchronously (interactions are
  instant; tabs/panes mint their ids client-side so nothing waits on IPC),
  server writes are background persistence, and while any write is in flight
  remote snapshot pushes are dropped; a dropped push triggers an authoritative
  re-fetch after the write batch settles, else the last settling write
  reconciles.

## UX

### The strip
- One strip, in the title bar (mounted by `AppShell`). Pills shrink to fit,
  labels fade at the right edge, close reveals on hover — unchanged.
- The pill renders the **focused pane's** identity (icon + label). A
  multi-pane tab replaces the icon with the layout glyph.
- Right-click context menu: Pin/Unpin, Close / Close others / to the right /
  to the left. Pins are view state (`pinnedTabsStore`), pinned-first display
  partition over pin-agnostic stored order — unchanged from v0.
- Cmd+T new tab, Cmd+W close active tab (inner-first vs task editor tabs),
  Cmd+1-9 switch (channels on). All are store mutations — no navigation.

### Splitting (merge a tab into another)
- **Flag-gated** by `TAB_SPLIT_PANES_FLAG` (`posthog-code-tab-split-panes`,
  `@posthog/shared`). Off (default): `BrowserTabsDnd` never arms
  `paneDragStore`, so no merge zones mount and pill drags can only reorder;
  the drag-end merge branch is also guarded. Existing multi-pane tabs still
  render (and can be closed back to single-pane) — only creating new splits
  is gated. No `import.meta.env.DEV` override — off means off in dev too.
- **Drag tab B's pill onto the content area** while tab A is active: 5 zones
  per pane (4 edges = split that side, center = merge to the right of that
  pane) + 4 thin root-edge zones (split at the layout root). Drop → B's whole
  pane subtree splices into A's layout (`mergeTabIntoTab` +
  `insertNodeInLayout`; same-direction nesting flattens), B's pill disappears,
  focus lands on B's focused pane. Panes keep their ids, so their routers (and
  history) ride along — no router fix-ups.
- Dragging the ACTIVE tab's own pill arms no zones (a tab can't merge into
  itself); pill-over-pill stays a reorder.
- **Close a pane** with the hover X (top-right of each pane; multi-pane tabs
  only). The layout collapses (`closePane`); the last remaining pane makes the
  tab single-pane again (glyph drops). Closing the TAB closes all its panes.
- Panes resize via Chrome-style gutters (w-2 with a grab pill; commit on
  drag-end only, `setPaneSizes` tab-scoped). Focus ring: a pointer-transparent
  overlay driven by domain focus (`data-focused` ← `focusedPaneId`), shown
  only on multi-pane tabs. Clicking anywhere in a pane focuses it
  (capture-phase pointerdown).

### Opening, blanks, closing
- `openOrFocusTab` dedups across **every pane in the window**: if any pane
  already shows the identity, its tab activates and the pane focuses.
- `+` appends a blank single-pane tab; the strip handler pre-seeds its router
  at the default landing (`/website` new-tab page with channels on, `/code`
  otherwise). Navigating fills the pane in place.
- Closing the active tab focuses its neighbour (the pane tree just re-renders;
  no navigation). Closing the **primary** window's last tab backfills a fresh
  blank tab in the same transform (never-empty strip; ids minted renderer-side
  for optimistic agreement). A **secondary** window closes with its last tab.

## Gotchas / implementation notes

- **PaneChrome's reconcile effect is keyed on the LOCATION only**; the mirror
  is read fresh (`readMirror()`) — subscribing it to the mirror re-runs it in
  local-first gaps and mis-fires (same rule as the old strip effect).
- **Dedup is PUSH-only and never from a blank pane** — back/forward replays a
  pane's own history and must not be hijacked; a blank pane's first navigation
  is "fill me". The history action comes from the per-router tracker
  (`getPaneHistoryTracker(router).lastAction()`).
- **Don't clear `paneDragStore`/`tabReorderStore` synchronously in dragend** —
  rAF-defer so @dnd-kit finishes DOM cleanup (unmounting zones it still
  references throws).
- **BrowserPane creates routers at render time** (RouterProvider needs the
  instance immediately); the registry is the cache. Cleanup only when the pane
  is truly gone from the snapshot — NOT on transient unmounts (tab switches).
- **globals.css pins `[data-panel-resize-handle-enabled]` to 1px** for the
  task-detail panels — the pane gutters override with Tailwind important
  (`w-2!`/`h-2!`).
- **The `/website` index must not redirect to `channels[0]` while a blank pane
  is active or the strip is empty** — guarded via `activeTabIsBlank` (focused
  pane blank) and `primaryWindowHasNoTabs`, plus the stale-index-render check
  in `WebsiteChannelsIndex`.
- **All writes are local-first (`tabsSync.ts`).** Don't add a mutation
  `onSuccess` that calls `setSnapshot`; route new writes through
  `applyLocalTransform` + `persistWrite`.
- **Imperative navigation targets the focused pane.** `routerRef.getRouterOrNull`
  and `navigationBridge` resolve through `paneRouterRegistry` — "the" router is
  the active tab's focused pane's.
- **Settings renders through a portal** (PaneChrome) covering the window while
  staying a route in the pane's history, so `history.back()` still exits it.

## Testing

- **Pure behaviour** in `@posthog/shared`: `browser-tabs.test.ts` (transforms,
  integrity healing, `decidePaneNavigation`) and
  `browser-pane-layout.test.ts` (tree math incl. `insertNodeInLayout`
  subtree splices and normalize identity-preservation).
- **Presentational** rendering in `TabStrip.test.tsx`; sync policy in
  `tabsSync.test.ts`.
- Live verification: drive the real app over CDP (`test-electron-app` skill) —
  merge drops work with synthetic mouse events; resizable-panel gutter drags
  do not (buttons=1 isn't held), use a real mouse for those.

## Known rough edges / follow-ups

- Inactive tabs unmount their panes (terminals detach on tab switch) — same
  as pre-split behaviour, not a regression.
- Tear-off to a second OS window is modelled (`browser_windows`, secondary
  close semantics) but unwired.
- Many pinned tabs overflow the strip (clip, no scroll) — follow-up.
- Scroll restoration (`scrollState`, now on panes) is reserved/unwired.

## Dev note

Changes to the main process (a new migration, service method, or router
procedure) or to `@posthog/shared` (vite pre-bundles it) need a **`pnpm dev`
restart** to run live — HMR alone won't apply them.
