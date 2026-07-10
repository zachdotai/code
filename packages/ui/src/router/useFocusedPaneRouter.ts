import { browserTabsStore } from "@posthog/core/browser-tabs/browserTabsStore";
import { focusedPane, primaryWindow } from "@posthog/shared";
import { useSyncExternalStore } from "react";
import { useStore } from "zustand";
import {
  type AppRouter,
  getFocusedRouterOrNull,
  getPaneRoutersVersion,
  subscribePaneRouters,
} from "./paneRouterRegistry";

/**
 * The focused pane's router, reactively: re-resolves when window focus moves
 * to another pane (tabs mirror) or when pane routers register/unregister.
 * AppShell binds its RouterContextProvider to this, which is what makes every
 * chrome hook (sidebar, title bar, useAppView) follow the focused pane.
 */
export function useFocusedPaneRouter(): AppRouter | null {
  useStore(browserTabsStore, (s) => {
    const win = primaryWindow(s.snapshot);
    return win ? (focusedPane(s.snapshot, win.id)?.id ?? null) : null;
  });
  useSyncExternalStore(subscribePaneRouters, getPaneRoutersVersion);
  return getFocusedRouterOrNull();
}
