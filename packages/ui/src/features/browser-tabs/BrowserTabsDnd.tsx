import { type DragDropEvents, DragDropProvider } from "@dnd-kit/react";
import { browserTabsStore } from "@posthog/core/browser-tabs/browserTabsStore";
import { useHostTRPC } from "@posthog/host-router/react";
import {
  moveTabToPane,
  type SplitDropDirection,
  setTabOrder,
  splitPane,
  type TabsSnapshot,
} from "@posthog/shared";
import { getPaneRouter } from "@posthog/ui/router/paneRouterRegistry";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useRef } from "react";
import { reorderWithinGroup, storedOrderIds } from "./displayOrder";
import { usePaneDragStore } from "./panes/paneDragStore";
import { usePinnedTabsStore } from "./pinnedTabsStore";
import { hrefForTab } from "./tabHref";
import { useTabReorderStore } from "./tabReorderStore";
import { applyLocalTransform, persistWrite } from "./tabsSync";

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * DnD scope for browser-tab pill drags, mounted around the whole shell (it
 * must span every pane's strip and the pane/root drop zones). Handlers ignore
 * any drag that isn't a browser tab, so task-detail's nested panel DnD
 * provider keeps working untouched inside pane content.
 *
 * Three drop families:
 * - pill over pill in the SAME pane → live reorder preview via the transient
 *   tabReorderStore (never the domain mirror — a server push mid-drag can't
 *   clobber it and a cancel just drops the preview), persisted on dragend;
 * - pill onto another pane's strip bar / pills / center zone → move the tab
 *   into that pane;
 * - pill onto a pane's edge zone or a content-area root edge → split.
 *
 * Every structural drop is one applyLocalTransform + one persistWrite (the
 * tabsSync local-first policy), plus imperative history pushes on the
 * affected pane routers — the moved tab's content must show in its new pane,
 * and a source pane whose active tab left needs its survivor's route.
 */
export function BrowserTabsDndProvider({ children }: { children: ReactNode }) {
  const trpc = useHostTRPC();
  const setOrder = useMutation(trpc.browserTabs.setOrder.mutationOptions());
  const moveTabMutation = useMutation(
    trpc.browserTabs.moveTabToPane.mutationOptions(),
  );
  const splitPaneMutation = useMutation(
    trpc.browserTabs.splitPane.mutationOptions(),
  );
  /** Stored order captured at dragstart — used to skip a no-op persist. */
  const initialOrder = useRef<string[] | null>(null);

  // Point the affected panes' routers at their (new) active tabs after a
  // structural change: the destination shows the moved tab, and a surviving
  // source pane whose active tab moved away shows its successor. Panes whose
  // active tab is unchanged are left alone.
  const syncPaneRouters = (
    before: TabsSnapshot,
    after: TabsSnapshot,
    paneIds: (string | undefined)[],
  ) => {
    for (const paneId of paneIds) {
      if (!paneId) continue;
      const prev = before.panes.find((p) => p.id === paneId)?.activeTabId;
      const pane = after.panes.find((p) => p.id === paneId);
      if (!pane?.activeTabId || pane.activeTabId === prev) continue;
      const tab = after.tabs.find((t) => t.id === pane.activeTabId);
      const router = getPaneRouter(paneId);
      if (tab && router) {
        router.history.push(hrefForTab(tab), { tabId: tab.id });
      }
    }
  };

  const onDragStart: DragDropEvents["dragstart"] = (event) => {
    const src = event.operation.source?.data;
    if (src?.type !== "browser-tab" || !src.tabId || !src.paneId) return;
    const snapshot = browserTabsStore.getState().snapshot;
    const order = storedOrderIds(snapshot, src.paneId);
    initialOrder.current = order;
    useTabReorderStore.getState().setPreviewOrder(order);
    // Mounts every pane's drop zones + the root edge zones.
    usePaneDragStore.getState().setDrag({
      tabId: src.tabId,
      sourcePaneId: src.paneId,
    });
  };

  const onDragOver: DragDropEvents["dragover"] = (event) => {
    const src = event.operation.source?.data;
    const tgt = event.operation.target?.data;
    if (
      src?.type !== "browser-tab" ||
      tgt?.type !== "browser-tab" ||
      !src.tabId ||
      !tgt.tabId ||
      src.tabId === tgt.tabId ||
      // Cross-pane pill hover is a MOVE (resolved on drop), not a reorder.
      src.paneId !== tgt.paneId
    ) {
      return;
    }
    const store = useTabReorderStore.getState();
    const snapshot = browserTabsStore.getState().snapshot;
    const cur = store.previewOrder ?? storedOrderIds(snapshot, src.paneId);
    const pinnedTabIds = usePinnedTabsStore.getState().pinnedTabIds;
    // Reorder within the dragged tab's pin group only; cross-group drags are
    // rejected (pinned pills can't land among unpinned tabs, or vice versa).
    const next = reorderWithinGroup(cur, pinnedTabIds, src.tabId, tgt.tabId);
    if (!sameOrder(next, cur)) store.setPreviewOrder(next);
  };

  const onDragEnd: DragDropEvents["dragend"] = (event) => {
    const src = event.operation.source?.data;
    const tgt = event.operation.target?.data;
    const order = useTabReorderStore.getState().previewOrder;
    const initial = initialOrder.current;
    initialOrder.current = null;
    // Defer clearing the transient stores + mutating a frame so @dnd-kit
    // finishes its DOM cleanup first (clearing paneDragStore synchronously
    // unmounts drop zones dnd-kit still references — same gotcha as the
    // panels feature).
    requestAnimationFrame(() => {
      useTabReorderStore.getState().setPreviewOrder(null);
      usePaneDragStore.getState().setDrag(null);
      if (event.canceled || src?.type !== "browser-tab" || !src.tabId) return;
      const sourcePaneId: string = src.paneId;
      const tabId: string = src.tabId;
      const before = browserTabsStore.getState().snapshot;
      const tab = before.tabs.find((t) => t.id === tabId);
      if (!tab) return;

      // Cross-pane move: drop on another pane's pill, strip bar, or center zone.
      const moveTarget =
        (tgt?.type === "browser-tab" ||
          tgt?.type === "browser-tab-strip-bar") &&
        tgt.paneId !== sourcePaneId
          ? (tgt.paneId as string)
          : tgt?.type === "browser-pane-zone" &&
              tgt.zone === "center" &&
              tgt.paneId !== sourcePaneId
            ? (tgt.paneId as string)
            : null;
      if (moveTarget) {
        const after = applyLocalTransform((s) =>
          moveTabToPane(s, { tabId, toPaneId: moveTarget, now: Date.now }),
        );
        if (after === before) return;
        syncPaneRouters(before, after, [moveTarget, sourcePaneId]);
        void persistWrite(() =>
          moveTabMutation.mutateAsync({ tabId, toPaneId: moveTarget }),
        );
        return;
      }

      // Split: a pane's edge zone, or a content-area root edge.
      const splitTarget =
        tgt?.type === "browser-pane-zone" && tgt.zone !== "center"
          ? {
              targetPaneId: tgt.paneId as string,
              direction: tgt.zone as SplitDropDirection,
            }
          : tgt?.type === "browser-root-zone"
            ? {
                targetPaneId: null,
                direction: tgt.zone as SplitDropDirection,
              }
            : null;
      if (splitTarget) {
        const newPaneId = crypto.randomUUID();
        const after = applyLocalTransform(
          (s) =>
            splitPane(s, {
              windowId: tab.windowId,
              targetPaneId: splitTarget.targetPaneId,
              direction: splitTarget.direction,
              tabId,
              newPaneId,
              now: Date.now,
            }).snapshot,
        );
        if (after === before) return;
        // The new pane's router is created on mount (BrowserPane) seeded from
        // the moved tab; only a surviving source pane needs a route fix here.
        syncPaneRouters(before, after, [sourcePaneId]);
        void persistWrite(() =>
          splitPaneMutation.mutateAsync({
            windowId: tab.windowId,
            targetPaneId: splitTarget.targetPaneId,
            direction: splitTarget.direction,
            tabId,
            paneId: newPaneId,
          }),
        );
        return;
      }

      // Same-pane reorder (pill/strip-bar drop within the source pane).
      if (!order || (initial && sameOrder(order, initial))) return;
      applyLocalTransform((s) => setTabOrder(s, sourcePaneId, order));
      void persistWrite(() =>
        setOrder.mutateAsync({ paneId: sourcePaneId, tabIds: order }),
      );
    });
  };

  return (
    <DragDropProvider
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      {children}
    </DragDropProvider>
  );
}
