import { z } from "zod";

/**
 * Persisted browser-tab domain shapes for the Channels canvas surface.
 *
 * A tab stores references only (which canvas, which channel, which window,
 * and where in the strip). Display — label, icon, channel-hover — is resolved
 * at render time from the dashboard/channel records, never denormalised here.
 *
 * `scrollState` is reserved for a later follow-up (scroll restoration needs a
 * sandbox postMessage contract). It is persisted as opaque JSON so adding it
 * needs no migration.
 */
export const browserTabSchema = z.object({
  id: z.string(),
  windowId: z.string(),
  /**
   * Pane this tab lives in. Invariant (healed on load): the pane exists and
   * `pane.windowId === tab.windowId`. `windowId` is kept denormalised so
   * window-scoped queries need no pane join.
   */
  paneId: z.string(),
  /** Canvas this tab shows. Null for a task tab or a blank tab. */
  dashboardId: z.string().nullable(),
  /** Task this tab shows. Null for a canvas tab or a blank tab. */
  taskId: z.string().nullable().default(null),
  channelId: z.string().nullable().default(null),
  /**
   * Channel sub-section this tab fronts (`artifacts` / `history` /
   * `context`). Null = the channel home, or a non-channel tab (canvas / task /
   * blank). Pairs with `channelId`: the two together identify a channel tab.
   */
  channelSection: z.string().nullable().default(null),
  /**
   * Top-level app page this tab shows (`inbox` / `agents` / `skills` /
   * `mcp-servers` / `command-center` / `home`). Null for a canvas / task /
   * channel / blank tab. These pages have no channel, task, or dashboard id, so
   * this is what lets them be a real tab target (label + restore-on-refocus).
   */
  appView: z.string().nullable().default(null),
  /** Gap-spaced ordering key within a pane. Reindexed on collision. */
  position: z.number(),
  /**
   * Reserved/unwired. Opaque per-tab state for future scroll restoration etc.
   * Plain `z.unknown()` (not `.default(null)`) so the inferred shape matches
   * the tRPC-wire inference on the client — keeps the renderer facade type and
   * the transport type identical.
   */
  scrollState: z.unknown().optional(),
  createdAt: z.number(),
  lastActiveAt: z.number(),
});
export type BrowserTab = z.infer<typeof browserTabSchema>;

export const windowBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type WindowBounds = z.infer<typeof windowBoundsSchema>;

/** Where a dragged tab was dropped relative to a pane (or the window root). */
export const splitDropDirectionSchema = z.enum([
  "left",
  "right",
  "top",
  "bottom",
]);
export type SplitDropDirection = z.infer<typeof splitDropDirectionSchema>;

/**
 * Recursive split layout for a window's panes. A leaf references a pane row by
 * id; a split lays its children out along `direction` ("row" = side by side,
 * "column" = stacked) with `sizes` as fractions parallel to `children`
 * (renormalised on heal). Splits always hold >= 2 children and never nest a
 * same-direction split (both canonicalised by `normalizeLayout`).
 *
 * The explicit `z.ZodType<PaneLayoutNode>` annotation is required: `z.lazy`
 * cannot infer a recursive type, and the annotation also keeps the tRPC-wire
 * inference on the client identical to this type (same concern as
 * `scrollState` above).
 */
export type PaneLayoutNode =
  | { type: "leaf"; paneId: string }
  | {
      type: "split";
      direction: "row" | "column";
      children: PaneLayoutNode[];
      sizes: number[];
    };

export const paneLayoutNodeSchema: z.ZodType<PaneLayoutNode> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("leaf"), paneId: z.string() }),
    z.object({
      type: z.literal("split"),
      direction: z.enum(["row", "column"]),
      children: z.array(paneLayoutNodeSchema).min(2),
      sizes: z.array(z.number()),
    }),
  ]),
);

/**
 * A pane: one tab strip + content area inside a window's split layout. The
 * layout tree carries the geometry; this row carries the mutable focus state.
 * Every pane holds >= 1 tab after healing (a pane emptied by closing its last
 * tab is backfilled with a blank tab; one emptied by a move/split collapses).
 */
export const browserPaneSchema = z.object({
  id: z.string(),
  windowId: z.string(),
  /**
   * Focused tab in this pane. Nullable for healing tolerance only — non-null
   * after `ensureSnapshotIntegrity` (every pane has a tab to focus).
   */
  activeTabId: z.string().nullable().default(null),
  createdAt: z.number(),
});
export type BrowserPane = z.infer<typeof browserPaneSchema>;

export const browserWindowSchema = z.object({
  id: z.string(),
  isPrimary: z.boolean(),
  /** Saved geometry for session restore. Null on web / before first persist. */
  bounds: windowBoundsSchema.nullable().default(null),
  /** Root of the pane layout. A single-pane window is a bare leaf. */
  layout: paneLayoutNodeSchema,
  /** Pane that owns focus: keyboard shortcuts, default open target, and the
   * global back/forward buttons all act on this pane. */
  focusedPaneId: z.string(),
});
export type BrowserWindow = z.infer<typeof browserWindowSchema>;

/** Full persisted snapshot, the source of truth held by TabsService. */
export const tabsSnapshotSchema = z.object({
  windows: z.array(browserWindowSchema),
  panes: z.array(browserPaneSchema),
  tabs: z.array(browserTabSchema),
});
export type TabsSnapshot = z.infer<typeof tabsSnapshotSchema>;
