import { type DragDropEvents, DragDropProvider } from "@dnd-kit/react";
import { browserTabsStore } from "@posthog/core/browser-tabs/browserTabsStore";
import { useHostTRPC } from "@posthog/host-router/react";
import {
  mergeTabIntoTab,
  primaryWindow,
  type SplitDropDirection,
  setTabOrder,
} from "@posthog/shared";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useRef } from "react";
import { reorderWithinGroup, storedOrderIds } from "./displayOrder";
import { usePaneDragStore } from "./panes/paneDragStore";
import { usePinnedTabsStore } from "./pinnedTabsStore";
import { useTabReorderStore } from "./tabReorderStore";
import { applyLocalTransform, persistWrite } from "./tabsSync";

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * DnD scope for browser-tab pill drags, mounted around the whole shell (it
 * must span the title-bar strip and the active tab's pane/root drop zones).
 * Handlers ignore any drag that isn't a browser tab, so task-detail's nested
 * panel DnD provider keeps working untouched inside pane content.
 *
 * Two drop families:
 * - pill over pill → live reorder preview via the transient tabReorderStore
 *   (never the domain mirror — a server push mid-drag can't clobber it and a
 *   cancel just drops the preview), persisted on dragend;
 * - pill onto a pane's merge zone / a content-area root edge → the dragged
 *   tab merges INTO the active tab as a split (its pill disappears; the
 *   active tab gains its panes). Center zone = merge to the right of that
 *   pane.
 *
 * Every structural drop is one applyLocalTransform + one persistWrite (the
 * tabsSync local-first policy). No router work is needed: panes keep their
 * ids across a merge, so their routers (and locations) ride along.
 */
export function BrowserTabsDndProvider({ children }: { children: ReactNode }) {
  const trpc = useHostTRPC();
  const setOrder = useMutation(trpc.browserTabs.setOrder.mutationOptions());
  const mergeMutation = useMutation(
    trpc.browserTabs.mergeTabIntoTab.mutationOptions(),
  );
  /** Stored order captured at dragstart — used to skip a no-op persist. */
  const initialOrder = useRef<string[] | null>(null);

  const onDragStart: DragDropEvents["dragstart"] = (event) => {
    const src = event.operation.source?.data;
    if (src?.type !== "browser-tab" || !src.tabId) return;
    const snapshot = browserTabsStore.getState().snapshot;
    const win = primaryWindow(snapshot);
    if (!win) return;
    const order = storedOrderIds(snapshot, win.id);
    initialOrder.current = order;
    useTabReorderStore.getState().setPreviewOrder(order);
    // Arm the merge drop zones — but never for the ACTIVE tab's own pill
    // (a tab can't merge into itself; PaneChrome double-checks per pane).
    if (src.tabId !== win.activeTabId) {
      usePaneDragStore.getState().setDrag({ tabId: src.tabId });
    }
  };

  const onDragOver: DragDropEvents["dragover"] = (event) => {
    const src = event.operation.source?.data;
    const tgt = event.operation.target?.data;
    if (
      src?.type !== "browser-tab" ||
      tgt?.type !== "browser-tab" ||
      !src.tabId ||
      !tgt.tabId ||
      src.tabId === tgt.tabId
    ) {
      return;
    }
    const store = useTabReorderStore.getState();
    const snapshot = browserTabsStore.getState().snapshot;
    const win = primaryWindow(snapshot);
    if (!win) return;
    const cur = store.previewOrder ?? storedOrderIds(snapshot, win.id);
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
      const tabId: string = src.tabId;
      const snapshot = browserTabsStore.getState().snapshot;
      const win = primaryWindow(snapshot);
      if (!win) return;

      // Merge: a pane zone of the active tab, or a content-area root edge.
      // Center = "merge here", implemented as adjacent-right of that pane.
      const merge =
        tgt?.type === "browser-pane-zone"
          ? {
              targetPaneId: tgt.paneId as string,
              direction: (tgt.zone === "center"
                ? "right"
                : tgt.zone) as SplitDropDirection,
            }
          : tgt?.type === "browser-root-zone"
            ? {
                targetPaneId: null,
                direction: tgt.zone as SplitDropDirection,
              }
            : null;
      if (merge && win.activeTabId && win.activeTabId !== tabId) {
        const targetTabId = win.activeTabId;
        const input = {
          windowId: win.id,
          sourceTabId: tabId,
          targetTabId,
          targetPaneId: merge.targetPaneId,
          direction: merge.direction,
        };
        const before = snapshot;
        const after = applyLocalTransform((s) =>
          mergeTabIntoTab(s, { ...input, now: Date.now }),
        );
        if (after === before) return;
        void persistWrite(() => mergeMutation.mutateAsync(input));
        return;
      }

      // Same-strip reorder (pill drop over the strip).
      if (!order || (initial && sameOrder(order, initial))) return;
      applyLocalTransform((s) => setTabOrder(s, win.id, order));
      void persistWrite(() =>
        setOrder.mutateAsync({ windowId: win.id, tabIds: order }),
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
