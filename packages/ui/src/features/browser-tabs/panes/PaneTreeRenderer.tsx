import { useHostTRPC } from "@posthog/host-router/react";
import {
  collectLeafPaneIds,
  type PaneLayoutNode,
  primaryWindow,
  setPaneSizes,
} from "@posthog/shared";
import { useMutation } from "@tanstack/react-query";
import { Fragment, useRef } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { applyLocalTransform, persistWrite } from "../tabsSync";
import { useTabsSnapshot } from "../useBrowserTabs";
import { BrowserPane } from "./BrowserPane";
import { usePaneDragStore } from "./paneDragStore";
import { RootDropZones } from "./RootDropZones";

const MIN_PANE_SIZE = 15;
const PERSIST_DEBOUNCE_MS = 300;

/**
 * Renders the primary window's pane layout: a lone leaf renders its pane
 * directly (single-pane mode — no group wrapper, pixel-identical to a plain
 * content area), a split renders a resizable PanelGroup recursively (the
 * GroupNodeRenderer pattern from the task-detail panels feature).
 *
 * Sizes: panels stay UNCONTROLLED (defaultSize); onLayout writes each split's
 * live sizes into a ref keyed by path, and only the resize-handle's drag-end
 * commits — one applyLocalTransform + one debounced persistWrite. Per-frame
 * writes into the domain mirror would churn every snapshot subscriber and
 * hold the tabsSync in-flight gate open (dropping remote pushes) for the
 * whole gesture.
 */
export function PaneTreeRenderer() {
  const snapshot = useTabsSnapshot();
  const trpc = useHostTRPC();
  const setPaneSizesMutation = useMutation(
    trpc.browserTabs.setPaneSizes.mutationOptions(),
  );
  const liveSizes = useRef(new Map<string, number[]>());
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = usePaneDragStore((s) => s.drag);

  const win = primaryWindow(snapshot);
  if (!win) return null;
  const windowId = win.id;
  const multiPane = win.layout.type === "split";

  const commitSizes = (path: number[]) => {
    const sizes = liveSizes.current.get(path.join("."));
    if (!sizes) return;
    const fractions = sizes.map((s) => s / 100);
    applyLocalTransform((s) => setPaneSizes(s, windowId, path, fractions));
    if (persistTimer.current) clearTimeout(persistTimer.current);
    // Trailing debounce also covers keyboard-driven handle resizes, which
    // have no drag-end.
    persistTimer.current = setTimeout(() => {
      void persistWrite(() =>
        setPaneSizesMutation.mutateAsync({ windowId, path, sizes: fractions }),
      );
    }, PERSIST_DEBOUNCE_MS);
  };

  const renderNode = (node: PaneLayoutNode, path: number[]) => {
    if (node.type === "leaf") {
      return (
        <BrowserPane
          paneId={node.paneId}
          windowId={windowId}
          showFocusRing={multiPane}
          isFocused={win.focusedPaneId === node.paneId}
        />
      );
    }
    const pathKey = path.join(".");
    // Key the group on its structural signature so a split/close remounts it
    // with fresh defaultSizes (panels are uncontrolled).
    const signature = node.children
      .map((c) => collectLeafPaneIds(c).join("+"))
      .join("|");
    return (
      <PanelGroup
        key={`${node.direction}:${signature}`}
        direction={node.direction === "row" ? "horizontal" : "vertical"}
        onLayout={(sizes) => liveSizes.current.set(pathKey, sizes)}
      >
        {node.children.map((child, i) => (
          <Fragment
            key={
              child.type === "leaf"
                ? child.paneId
                : `split-${collectLeafPaneIds(child).join("+")}`
            }
          >
            <Panel
              order={i}
              defaultSize={(node.sizes[i] ?? 1 / node.children.length) * 100}
              minSize={MIN_PANE_SIZE}
            >
              {renderNode(child, [...path, i])}
            </Panel>
            {i < node.children.length - 1 && (
              <PanelResizeHandle
                onDragging={(isDragging) => {
                  if (!isDragging) commitSizes(path);
                }}
                className={`bg-border data-[resize-handle-state=drag]:bg-accent data-[resize-handle-state=hover]:bg-accent/60 ${
                  node.direction === "row" ? "w-px" : "h-px"
                }`}
              />
            )}
          </Fragment>
        ))}
      </PanelGroup>
    );
  };

  // Root edge zones can't produce a new layout when the whole window is one
  // pane holding only the dragged tab.
  const rootZonesEnabled =
    !!drag &&
    (multiPane ||
      snapshot.tabs.filter((t) => t.paneId === drag.sourcePaneId).length > 1);

  return (
    <div className="relative h-full min-h-0 w-full">
      {renderNode(win.layout, [])}
      <RootDropZones enabled={rootZonesEnabled} />
    </div>
  );
}
