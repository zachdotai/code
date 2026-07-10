import {
  splitDropDirectionSchema,
  type TabsSnapshot,
  tabsSnapshotSchema,
} from "@posthog/shared";
import { z } from "zod";

/** tRPC output: the full durable tab/pane/window snapshot. */
export const browserTabsSnapshotOutput = tabsSnapshotSchema;

export const openOrFocusTabInput = z.object({
  paneId: z.string(),
  dashboardId: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  channelId: z.string().nullable().default(null),
  channelSection: z.string().nullable().default(null),
  appView: z.string().nullable().default(null),
  // Renderer-minted id for a tab this call may create, so the optimistic local
  // apply and the persisted state agree on the id (local-first tab sync).
  tabId: z.string().optional(),
});

export const newBlankTabInput = z.object({
  paneId: z.string(),
  // Renderer-minted id (see openOrFocusTabInput.tabId).
  tabId: z.string().optional(),
});

export const setTabTargetInput = z.object({
  tabId: z.string(),
  dashboardId: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  channelId: z.string().nullable().default(null),
  channelSection: z.string().nullable().default(null),
  appView: z.string().nullable().default(null),
});

export const closeTabInput = z.object({
  tabId: z.string(),
  // Renderer-minted id for the blank tab backfilled when the close empties a
  // pane — minted client-side for the same reason as openOrFocusTabInput.tabId
  // (blank tabs have no identity to dedup on, so a replay must not mint twice).
  blankTabId: z.string().optional(),
});

export const closeTabsInput = z.object({
  tabIds: z.array(z.string()),
  // The bulk close's anchor (the right-clicked tab, which always survives);
  // focus falls to it when the active tab is among those closed.
  focusTabId: z.string().nullable().default(null),
  // Renderer-minted blank-backfill id (see closeTabInput.blankTabId).
  blankTabId: z.string().optional(),
});

export const setTabOrderInput = z.object({
  paneId: z.string(),
  tabIds: z.array(z.string()),
});

export const setActiveTabInput = z.object({
  paneId: z.string(),
  tabId: z.string(),
});

export const splitPaneInput = z.object({
  windowId: z.string(),
  /** Pane whose edge received the drop; null = a window-root edge drop. */
  targetPaneId: z.string().nullable().default(null),
  direction: splitDropDirectionSchema,
  /** The dragged tab, moved into the new pane. */
  tabId: z.string(),
  // Renderer-minted id for the created pane (idempotent on replay).
  paneId: z.string().optional(),
});

export const moveTabToPaneInput = z.object({
  tabId: z.string(),
  toPaneId: z.string(),
  /** Displayed slot to insert at; appended when omitted. */
  index: z.number().int().min(0).optional(),
});

export const closePaneInput = z.object({
  windowId: z.string(),
  paneId: z.string(),
  // Renderer-minted blank id for the primary-window last-pane reset.
  blankTabId: z.string().optional(),
});

export const setFocusedPaneInput = z.object({
  windowId: z.string(),
  paneId: z.string(),
});

export const setPaneSizesInput = z.object({
  windowId: z.string(),
  /** Child-index path from the layout root to the split being resized. */
  path: z.array(z.number().int().min(0)),
  sizes: z.array(z.number().positive()),
});

export enum BrowserTabsEvent {
  SnapshotChange = "snapshotChange",
}

export type BrowserTabsEvents = {
  [BrowserTabsEvent.SnapshotChange]: TabsSnapshot;
};
