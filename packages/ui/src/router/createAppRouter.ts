import {
  createMemoryHistory,
  createRouter as createTanStackRouter,
} from "@tanstack/react-router";
import { readPaneLocation, writePaneLocation } from "./paneLocationPersistence";
import { RouteNotFound } from "./RouteNotFound";
import { RoutePending } from "./RoutePending";
import { routeTree } from "./routeTree.gen";

/**
 * Per-pane router factory. Every pane hosts its own router instance over the
 * shared generated route tree, each with an in-memory history — per-pane
 * back/forward falls out by construction, and no pane owns `window.location`
 * (the app is Electron-hosted; nothing reads the URL bar). The previous
 * window-wide hash router is gone.
 *
 * Location durability: memory history dies with the page, so every navigation
 * writes the pane's current href to sessionStorage (see
 * paneLocationPersistence) and boot restores it — this is what keeps Cmd+R and
 * HMR full reloads on the same screen now that the hash no longer carries it.
 */
export function createAppRouter(opts: { paneId: string; initialHref: string }) {
  const history = createMemoryHistory({ initialEntries: [opts.initialHref] });
  const router = createTanStackRouter({
    routeTree,
    history,
    // Which pane this router belongs to — read by PaneChrome via route
    // context (__root is createRootRouteWithContext<{paneId}>).
    context: { paneId: opts.paneId },
    defaultPreload: "intent",
    // Preloads only warm code imports — never satisfy a navigation's loader.
    // Loaders here are single-frame yields (see yieldToPaint) whose whole point
    // is to run ON navigation so the pending skeleton paints; a hover-preloaded
    // loader result would let the navigation commit synchronously and freeze the
    // old screen through the destination's heavy mount again.
    defaultPreloadStaleTime: 0,
    // Show the route's pending UI the instant its loader is still resolving, so
    // navigation commits immediately instead of stalling on the previous screen.
    defaultPendingMs: 0,
    // Don't hold the pending UI for the default 500ms minimum — skeletons paint
    // for exactly the frame(s) a `yieldToPaint()` loader needs, then the real
    // view replaces them as soon as it has rendered.
    defaultPendingMinMs: 0,
    defaultPendingComponent: RoutePending,
    defaultNotFoundComponent: RouteNotFound,
    scrollRestoration: false,
  });

  // Forward-availability + last-action tracker. It must live WITH the router
  // (not in component state): the title bar swaps routers when pane focus
  // moves and would otherwise lose the counter, and PaneChrome's reconcile
  // effect reads the action that produced the current location. Installed
  // before the persistence subscriber so listeners always observe an
  // up-to-date max index.
  let maxIndex = currentIndex(router);
  let lastAction: HistoryActionType = null;
  const listeners = new Set<() => void>();
  history.subscribe(({ location, action }) => {
    const idx = location.state.__TSR_index;
    // Only a PUSH wipes the forward stack, so it resets the newest to the
    // current index. REPLACE mutates the current entry in place (index
    // unchanged, forward entries intact) and BACK/GO just move within the
    // existing stack, so both keep the max.
    maxIndex = action.type === "PUSH" ? idx : Math.max(maxIndex, idx);
    lastAction = action.type;
    for (const listener of listeners) listener();
    writePaneLocation(opts.paneId, location.href);
  });
  trackers.set(router, {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    canGoForward: () => currentIndex(router) < maxIndex,
    lastAction: () => lastAction,
  });

  return router;
}

export type AppRouter = ReturnType<typeof createAppRouter>;

function currentIndex(router: AppRouter): number {
  return router.history.location.state.__TSR_index;
}

/** The history action that produced the current location; null before the
 * first navigation (the initial entry was not navigated to). */
export type HistoryActionType =
  | "PUSH"
  | "REPLACE"
  | "BACK"
  | "FORWARD"
  | "GO"
  | null;

export type PaneHistoryTracker = {
  /** Fires on every history change of the pane. */
  subscribe: (listener: () => void) => () => void;
  canGoForward: () => boolean;
  lastAction: () => HistoryActionType;
};

const trackers = new WeakMap<AppRouter, PaneHistoryTracker>();

const NULL_TRACKER: PaneHistoryTracker = {
  subscribe: () => () => {},
  canGoForward: () => false,
  lastAction: () => null,
};

/** The forward tracker installed by {@link createAppRouter}. Routers created
 * elsewhere (tests, Storybook) get an inert tracker. */
export function getPaneHistoryTracker(router: AppRouter): PaneHistoryTracker {
  return trackers.get(router) ?? NULL_TRACKER;
}

/** Boot helper: the pane's persisted location, if this page session has one. */
export function persistedPaneHref(paneId: string): string | null {
  return readPaneLocation(paneId);
}

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
