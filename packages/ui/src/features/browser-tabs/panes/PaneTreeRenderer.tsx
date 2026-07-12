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
 * Renders the ACTIVE TAB's pane layout: a lone leaf renders its pane directly
 * (single-pane mode — no group wrapper, pixel-identical to a plain content
 * area), a split renders a resizable PanelGroup recursively (the
 * GroupNodeRenderer pattern from the task-detail panels feature). Switching
 * tabs swaps the whole tree; inactive tabs' panes unmount but their routers
 * stay cached in the pane router registry, so their locations survive.
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
  const activeTab = win?.activeTabId
    ? snapshot.tabs.find((t) => t.id === win.activeTabId)
    : undefined;
  if (!win || !activeTab) return null;
  const tabId = activeTab.id;
  const multiPane = activeTab.layout.type === "split";

  const commitSizes = (path: number[]) => {
    const sizes = liveSizes.current.get(path.join("."));
    if (!sizes) return;
    const fractions = sizes.map((s) => s / 100);
    applyLocalTransform((s) => setPaneSizes(s, tabId, path, fractions));
    if (persistTimer.current) clearTimeout(persistTimer.current);
    // Trailing debounce also covers keyboard-driven handle resizes, which
    // have no drag-end.
    persistTimer.current = setTimeout(() => {
      void persistWrite(() =>
        setPaneSizesMutation.mutateAsync({ tabId, path, sizes: fractions }),
      );
    }, PERSIST_DEBOUNCE_MS);
  };

  const renderNode = (node: PaneLayoutNode, path: number[]) => {
    if (node.type === "leaf") {
      return (
        <BrowserPane
          paneId={node.paneId}
          tabId={tabId}
          showFocusRing={multiPane}
          isFocused={activeTab.focusedPaneId === node.paneId}
        />
      );
    }
    const pathKey = path.join(".");
    // Key the group on its structural signature so a merge/close remounts it
    // with fresh defaultSizes (panels are uncontrolled).
    const signature = node.children
      .map((c) => collectLeafPaneIds(c).join("+"))
      .join("|");
    return (
      <PanelGroup
        key={`${node.direction}:${signature}`}
        direction={node.direction === "row" ? "horizontal" : "vertical"}
        onLayout={(sizes) => liveSizes.current.set(pathKey, sizes)}
        className="p-1"
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
              className="overflow-hidden rounded-xs border border-border"
            >
              {renderNode(child, [...path, i])}
            </Panel>
            {i < node.children.length - 1 && (
              // Chrome-style divider: a visible gutter between panes with a
              // small centered grab pill (the whole gutter is the hit area).
              <PanelResizeHandle
                onDragging={(isDragging) => {
                  if (!isDragging) commitSizes(path);
                }}
                // The `!` overrides globals.css's 1px hairline for the
                // task-detail panels ([data-panel-resize-handle-enabled]).
                className={`group flex items-center justify-center bg-background ${
                  node.direction === "row" ? "w-2!" : "h-2!"
                }`}
              >
                <div
                  className={`rounded-full bg-chrome transition-colors duration-150 group-hover:bg-accent/60 group-data-[resize-handle-state=drag]:bg-accent ${
                    node.direction === "row" ? "h-8 w-1" : "h-1 w-8"
                  }`}
                />
              </PanelResizeHandle>
            )}
          </Fragment>
        ))}
      </PanelGroup>
    );
  };

  // Root edge zones merge the dragged tab at this tab's layout root; a tab
  // can't merge into itself (the DnD provider also never arms the drag store
  // for the active tab's own pill — this is belt-and-braces for a tab switch
  // that races the drag).
  const rootZonesEnabled = !!drag && drag.tabId !== tabId;

  return (
    <div className="relative h-full min-h-0 w-full">
      {renderNode(activeTab.layout, [])}
      <RootDropZones enabled={rootZonesEnabled} />
    </div>
  );
}
