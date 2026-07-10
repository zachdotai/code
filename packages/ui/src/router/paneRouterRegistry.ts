// Leaf module holding the live pane→router map so imperative callers
// (navigationBridge, deep-link handlers, store actions) can reach a router
// WITHOUT a static `import { router } from "./router"`.
//
// That static import creates a cycle:
//   router.ts → routeTree.gen.ts → __root.tsx → hooks → navigationBridge → router.ts
// Under `autoCodeSplitting` each route's component becomes its own module that
// re-enters the cycle, and the TDZ ("Cannot access 'rootRouteImport' before
// initialization") leaves code-split route chunks stuck loading.
//
// The router `import type` below is erased at build time; the core-store import
// is runtime but core never imports the route tree, so the cycle stays open.
//
// Every pane hosts its own router instance (split panes each render their own
// route). "The" router for imperative navigation is the FOCUSED pane's — the
// pane the user is working in — resolved here from the tabs mirror.
import { browserTabsStore } from "@posthog/core/browser-tabs/browserTabsStore";
import { focusedPane, primaryWindow } from "@posthog/shared";
import type { AppRouter } from "./createAppRouter";

export type { AppRouter } from "./createAppRouter";

const paneRouters = new Map<string, AppRouter>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  for (const listener of listeners) listener();
}

/** Monotonic registration counter — a useSyncExternalStore snapshot for
 * consumers that re-resolve the focused router when the map changes. */
export function getPaneRoutersVersion(): number {
  return version;
}

export function setPaneRouter(paneId: string, router: AppRouter): void {
  paneRouters.set(paneId, router);
  notify();
}

export function removePaneRouter(paneId: string): void {
  paneRouters.delete(paneId);
  notify();
}

export function getPaneRouter(paneId: string): AppRouter | null {
  return paneRouters.get(paneId) ?? null;
}

/**
 * The focused pane's router: the mirror's focused pane when a router is
 * registered under that id, else — while the app runs a single router not yet
 * keyed by a real pane id (boot, single-pane mode) — the sole registered
 * instance. Null before any router exists (early boot, unit tests); callers
 * treat null as "no router, nothing to navigate".
 */
export function getFocusedRouterOrNull(): AppRouter | null {
  const snapshot = browserTabsStore.getState().snapshot;
  const win = primaryWindow(snapshot);
  const paneId = win ? focusedPane(snapshot, win.id)?.id : undefined;
  if (paneId) {
    const exact = paneRouters.get(paneId);
    if (exact) return exact;
  }
  if (paneRouters.size === 1) {
    return paneRouters.values().next().value ?? null;
  }
  return null;
}

/** Fires when a pane router is registered or removed. (Focus changes are
 * observed via the tabs mirror; combine both for a reactive focused router.) */
export function subscribePaneRouters(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
