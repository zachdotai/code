import type { SplitDropDirection, TabsSnapshot } from "@posthog/shared";

interface Subscriber<T> {
  onData: (data: T) => void;
  onError?: (error: unknown) => void;
}

/**
 * Renderer-facing facade over the host-router browserTabs procedures. Bound as
 * a passthrough in the renderer container; on web the same shape forwards over
 * HTTP. Mutations return the fresh snapshot, but windows also stay in sync via
 * onSnapshotChange, so callers can rely on the store rather than the return.
 */
export interface BrowserTabsClient {
  getSnapshot(): Promise<TabsSnapshot>;
  getPrimaryWindowId(): Promise<string>;
  openOrFocus(input: {
    paneId: string;
    dashboardId: string | null;
    taskId: string | null;
    channelId: string | null;
    channelSection?: string | null;
    appView?: string | null;
    /** Renderer-minted id for a tab this call may create (local-first sync). */
    tabId?: string;
  }): Promise<TabsSnapshot>;
  newBlankTab(input: {
    paneId: string;
    /** Renderer-minted id (see openOrFocus.tabId). */
    tabId?: string;
  }): Promise<TabsSnapshot>;
  setTabTarget(input: {
    tabId: string;
    dashboardId: string | null;
    taskId: string | null;
    channelId: string | null;
    channelSection?: string | null;
    appView?: string | null;
  }): Promise<TabsSnapshot>;
  close(input: {
    tabId: string;
    /** Renderer-minted id for the blank backfilled when a pane empties. */
    blankTabId?: string;
  }): Promise<TabsSnapshot>;
  setActiveTab(input: { paneId: string; tabId: string }): Promise<TabsSnapshot>;
  splitPane(input: {
    windowId: string;
    targetPaneId: string | null;
    direction: SplitDropDirection;
    tabId: string;
    /** Renderer-minted id for the created pane (idempotent on replay). */
    paneId?: string;
  }): Promise<TabsSnapshot>;
  moveTabToPane(input: {
    tabId: string;
    toPaneId: string;
    index?: number;
  }): Promise<TabsSnapshot>;
  closePane(input: {
    windowId: string;
    paneId: string;
    /** Renderer-minted blank id for the primary-window last-pane reset. */
    blankTabId?: string;
  }): Promise<TabsSnapshot>;
  setFocusedPane(input: {
    windowId: string;
    paneId: string;
  }): Promise<TabsSnapshot>;
  setPaneSizes(input: {
    windowId: string;
    path: number[];
    sizes: number[];
  }): Promise<TabsSnapshot>;
  onSnapshotChange(sub: Subscriber<TabsSnapshot>): { unsubscribe: () => void };
}

export const BROWSER_TABS_CLIENT = Symbol.for("posthog.ui.BrowserTabsClient");
