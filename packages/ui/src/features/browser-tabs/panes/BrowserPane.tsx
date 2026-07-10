import { useHostTRPC } from "@posthog/host-router/react";
import { focusedPane, primaryWindow, setFocusedPane } from "@posthog/shared";
import { hrefForTab } from "@posthog/ui/features/browser-tabs/tabHref";
import {
  createAppRouter,
  persistedPaneHref,
} from "@posthog/ui/router/createAppRouter";
import { removePaneLocation } from "@posthog/ui/router/paneLocationPersistence";
import {
  getPaneRouter,
  removePaneRouter,
  setPaneRouter,
} from "@posthog/ui/router/paneRouterRegistry";
import { useMutation } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";
import { applyLocalTransform, persistWrite, readMirror } from "../tabsSync";

/**
 * One leaf pane: focus boundary, its own router (looked up or lazily created
 * in the registry — panes minted by a split get a router on first mount,
 * seeded from the moved tab's canonical href), and the split/move drop-zone
 * overlay. The pane's tab strip renders INSIDE the router (PaneChrome), so
 * its navigation effect reconciles against this pane's own location.
 */
export function BrowserPane({
  paneId,
  windowId,
  showFocusRing,
  isFocused,
}: {
  paneId: string;
  windowId: string;
  showFocusRing: boolean;
  isFocused: boolean;
}) {
  const trpc = useHostTRPC();
  const setFocusedPaneMutation = useMutation(
    trpc.browserTabs.setFocusedPane.mutationOptions(),
  );

  // Look up or create the pane's router. Creation is render-time on purpose:
  // RouterProvider needs the instance immediately, and the registry acts as
  // the cache so re-renders (and sibling mounts) reuse one instance.
  let router = getPaneRouter(paneId);
  if (!router) {
    const mirror = readMirror();
    const pane = mirror.panes.find((p) => p.id === paneId);
    const activeTab = pane?.activeTabId
      ? mirror.tabs.find((t) => t.id === pane.activeTabId)
      : undefined;
    const initialHref =
      persistedPaneHref(paneId) ??
      (activeTab ? hrefForTab(activeTab) : "/code");
    router = createAppRouter({ paneId, initialHref });
    setPaneRouter(paneId, router);
    void router.load().catch(() => undefined);
  }

  // Drop the router (and its persisted location) once the pane is truly gone
  // from the snapshot — NOT on transient unmounts from tree re-renders.
  useEffect(() => {
    return () => {
      const stillExists = readMirror().panes.some((p) => p.id === paneId);
      if (!stillExists) {
        removePaneRouter(paneId);
        removePaneLocation(paneId);
      }
    };
  }, [paneId]);

  // Clicking anywhere in the pane focuses it. Capture-phase pointerdown so
  // focus lands before any content interaction and survives stopPropagation
  // inside the content; skipped when already focused so ordinary clicks in
  // the focused pane don't spam writes.
  const handlePointerDownCapture = () => {
    const mirror = readMirror();
    const win = primaryWindow(mirror);
    if (!win || win.id !== windowId) return;
    if (focusedPane(mirror, windowId)?.id === paneId) return;
    applyLocalTransform((s) => setFocusedPane(s, windowId, paneId));
    void persistWrite(() =>
      setFocusedPaneMutation.mutateAsync({ windowId, paneId }),
    );
  };

  return (
    <div
      data-pane-id={paneId}
      data-focused={isFocused || undefined}
      onPointerDownCapture={handlePointerDownCapture}
      className="group relative flex h-full min-h-0 w-full min-w-0 flex-col"
    >
      {/* Split/move drop zones mount INSIDE the router (PaneChrome), over the
        content slot only — overlaying the whole pane would swallow drops
        aimed at the strip bar/pills. */}
      <RouterProvider router={router} />
      {/* Focus ring as a pointer-transparent OVERLAY above the content: an
          inset ring on the pane element itself paints under its children, so
          anything flush with the edge (scrolling content, section headers)
          covers it. Driven by DOMAIN focus (data-focused ← focusedPaneId),
          not :focus-within — clicks on non-focusable content move no DOM
          focus, and in-pane navigation must keep its pane highlighted; every
          path already maintains focusedPaneId (pane pointerdown capture, tab
          activation, in-tab navigation). Below the drop zones (z-100). */}
      {showFocusRing ? (
        <div className="pointer-events-none absolute inset-0 z-90 hidden rounded-xs ring-2 ring-primary ring-inset group-data-focused:block" />
      ) : null}
    </div>
  );
}
