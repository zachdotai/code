import {
  splitDropDirectionSchema,
  type TabsSnapshot,
  tabsSnapshotSchema,
} from "@posthog/shared";
import { z } from "zod";

/** tRPC output: the full durable tab/window/pane snapshot. */
export const browserTabsSnapshotOutput = tabsSnapshotSchema;

const paneIdentityFields = {
  dashboardId: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  channelId: z.string().nullable().default(null),
  channelSection: z.string().nullable().default(null),
  appView: z.string().nullable().default(null),
};

export const openOrFocusTabInput = z.object({
  windowId: z.string(),
  ...paneIdentityFields,
  // Renderer-minted ids for the tab/pane this call may create, so the
  // optimistic local apply and the persisted state agree (local-first sync).
  tabId: z.string().optional(),
  paneId: z.string().optional(),
});

export const newBlankTabInput = z.object({
  windowId: z.string(),
  // Renderer-minted ids (see openOrFocusTabInput).
  tabId: z.string().optional(),
  paneId: z.string().optional(),
});

export const setPaneTargetInput = z.object({
  paneId: z.string(),
  ...paneIdentityFields,
});

export const closeTabInput = z.object({
  tabId: z.string(),
  // Renderer-minted ids for the blank tab backfilled when this close empties
  // the primary window's strip.
  blankTabId: z.string().optional(),
  blankPaneId: z.string().optional(),
});

export const closeTabsInput = z.object({
  tabIds: z.array(z.string()),
  // The bulk close's anchor (the right-clicked tab, which always survives);
  // focus falls to it when the active tab is among those closed.
  focusTabId: z.string().nullable().default(null),
});

export const closePaneInput = z.object({
  tabId: z.string(),
  paneId: z.string(),
});

export const mergeTabIntoTabInput = z.object({
  windowId: z.string(),
  sourceTabId: z.string(),
  targetTabId: z.string(),
  /** Pane the drop zone belonged to; null = the layout root (edge drop). */
  targetPaneId: z.string().nullable().default(null),
  direction: splitDropDirectionSchema,
});

export const setTabOrderInput = z.object({
  windowId: z.string(),
  tabIds: z.array(z.string()),
});

export const setActiveTabInput = z.object({
  windowId: z.string(),
  tabId: z.string().nullable(),
});

export const setFocusedPaneInput = z.object({
  tabId: z.string(),
  paneId: z.string(),
});

export const setPaneSizesInput = z.object({
  tabId: z.string(),
  /** Child-index path from the layout root to the split being resized. */
  path: z.array(z.number().int().min(0)),
  sizes: z.array(z.number()),
});

export enum BrowserTabsEvent {
  SnapshotChange = "snapshotChange",
}

export type BrowserTabsEvents = {
  [BrowserTabsEvent.SnapshotChange]: TabsSnapshot;
};
