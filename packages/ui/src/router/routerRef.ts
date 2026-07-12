// Leaf accessor for imperative navigation helpers (navigationBridge,
// deep-link handlers, store actions). Historically this held the single app
// router; with tab-owned split panes every pane hosts its own router, so "the"
// router is the FOCUSED pane's, resolved through the pane router registry.
// Kept as a separate module so callers stay out of the route-tree import
// cycle (see paneRouterRegistry.ts for the cycle description).
import type { AppRouter } from "./createAppRouter";
import { getFocusedRouterOrNull } from "./paneRouterRegistry";

export function getRouter(): AppRouter {
  const router = getFocusedRouterOrNull();
  if (!router) {
    throw new Error("Router accessed before initialization");
  }
  return router;
}

// Nullable accessor for imperative navigation helpers that must not throw when
// no pane router is mounted yet (early boot, unit tests). In the running app a
// focused pane's router always exists before these fire; callers treat null as
// "no router, nothing to navigate".
export function getRouterOrNull(): AppRouter | null {
  return getFocusedRouterOrNull();
}
