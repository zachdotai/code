import { browserTabsStore } from "@posthog/core/browser-tabs/browserTabsStore";
import { primaryWindow } from "@posthog/shared";
import { useSyncExternalStore } from "react";
import { useStore } from "zustand";
import {
  type AppRouter,
  getFocusedRouterOrNull,
  getPaneRoutersVersion,
  subscribePaneRouters,
} from "./paneRouterRegistry";

/**
 * The focused pane's router, reactively: re-resolves when the active tab or
 * its focused pane changes (tabs mirror) or when pane routers
 * register/unregister. AppShell binds its RouterContextProvider to this,
 * which is what makes every chrome hook (sidebar, title bar, useAppView)
 * follow the focused pane.
 */
export function useFocusedPaneRouter(): AppRouter | null {
  useStore(browserTabsStore, (s) => {
    const win = primaryWindow(s.snapshot);
    if (!win?.activeTabId) return null;
    return (
      s.snapshot.tabs.find((t) => t.id === win.activeTabId)?.focusedPaneId ??
      null
    );
  });
  useSyncExternalStore(subscribePaneRouters, getPaneRoutersVersion);
  return getFocusedRouterOrNull();
}
