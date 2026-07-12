import { useHostTRPC } from "@posthog/host-router/react";
import { paneIdentityOf, setFocusedPane } from "@posthog/shared";
import { hrefForIdentity } from "@posthog/ui/features/browser-tabs/tabHref";
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
 * One leaf pane of the active tab: focus boundary and its own router (looked
 * up or lazily created in the registry — panes gained by a merge get a router
 * on first mount, seeded from the pane's identity href). PaneChrome (the
 * root route inside the router) reconciles this pane's location back into the
 * snapshot via setPaneTarget.
 */
export function BrowserPane({
  paneId,
  tabId,
  showFocusRing,
  isFocused,
}: {
  paneId: string;
  tabId: string;
  showFocusRing: boolean;
  isFocused: boolean;
}) {
  const trpc = useHostTRPC();
  const setFocusedPaneMutation = useMutation(
    trpc.browserTabs.setFocusedPane.mutationOptions(),
  );

  // Look up or create the pane's router. Creation is render-time on purpose:
  // RouterProvider needs the instance immediately, and the registry acts as
  // the cache so re-renders (tab switches, sibling mounts) reuse one instance
  // — which is also what keeps an inactive tab's pane locations alive.
  let router = getPaneRouter(paneId);
  if (!router) {
    const pane = readMirror().panes.find((p) => p.id === paneId);
    const initialHref =
      persistedPaneHref(paneId) ??
      (pane ? hrefForIdentity(paneIdentityOf(pane)) : "/code");
    router = createAppRouter({ paneId, initialHref });
    setPaneRouter(paneId, router);
    void router.load().catch(() => undefined);
  }

  // Drop the router (and its persisted location) once the pane is truly gone
  // from the snapshot — NOT on transient unmounts (tab switches unmount every
  // pane of the outgoing tab; their routers must survive).
  useEffect(() => {
    return () => {
      const stillExists = readMirror().panes.some((p) => p.id === paneId);
      if (!stillExists) {
        removePaneRouter(paneId);
        removePaneLocation(paneId);
      }
    };
  }, [paneId]);

  // Clicking anywhere in the pane focuses it within its tab. Capture-phase
  // pointerdown so focus lands before any content interaction and survives
  // stopPropagation inside the content; skipped when already focused so
  // ordinary clicks in the focused pane don't spam writes.
  const handlePointerDownCapture = () => {
    const mirror = readMirror();
    const tab = mirror.tabs.find((t) => t.id === tabId);
    if (!tab || tab.focusedPaneId === paneId) return;
    applyLocalTransform((s) => setFocusedPane(s, tabId, paneId));
    void persistWrite(() =>
      setFocusedPaneMutation.mutateAsync({ tabId, paneId }),
    );
  };

  return (
    <div
      data-pane-id={paneId}
      data-focused={isFocused || undefined}
      onPointerDownCapture={handlePointerDownCapture}
      className="group relative flex h-full min-h-0 w-full min-w-0 flex-col"
    >
      {/* Merge drop zones mount INSIDE the router (PaneChrome), over the
        content slot only. */}
      <RouterProvider router={router} />
      {/* Focus ring as a pointer-transparent OVERLAY above the content: an
          inset ring on the pane element itself paints under its children, so
          anything flush with the edge (scrolling content, section headers)
          covers it. Driven by DOMAIN focus (data-focused ← focusedPaneId),
          not :focus-within — clicks on non-focusable content move no DOM
          focus, and in-pane navigation must keep its pane highlighted; every
          path already maintains focusedPaneId (pane pointerdown capture, open
          dedup, in-pane navigation). Below the drop zones (z-100). */}
      {showFocusRing ? (
        <div className="pointer-events-none absolute inset-0 z-90 hidden rounded-xs ring-2 ring-primary ring-inset group-data-focused:block" />
      ) : null}
    </div>
  );
}
