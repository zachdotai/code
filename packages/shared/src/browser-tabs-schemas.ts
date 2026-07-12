import { z } from "zod";

/**
 * Persisted browser-tab domain shapes for the Channels canvas surface.
 *
 * v2 model — one tab strip per window; each TAB owns a split-pane layout:
 *
 *   window → tabs (strip units, each with a `layout` tree + focused pane)
 *          → panes (content units carrying the identity: canvas / task /
 *                   channel / app view)
 *
 * A pane stores references only (which canvas, which channel). Display —
 * label, icon, channel-hover — is resolved at render time from the
 * dashboard/channel records, never denormalised here. A tab's label/icon
 * derive from its FOCUSED pane's identity.
 *
 * `scrollState` is reserved for a later follow-up (scroll restoration needs a
 * sandbox postMessage contract). It is persisted as opaque JSON so adding it
 * needs no migration.
 */

/** Where a dragged tab was dropped relative to a pane (or the layout root). */
export const splitDropDirectionSchema = z.enum([
  "left",
  "right",
  "top",
  "bottom",
]);
export type SplitDropDirection = z.infer<typeof splitDropDirectionSchema>;

/**
 * Recursive split layout for a tab's panes. A leaf references a pane row by
 * id; a split lays its children out along `direction` ("row" = side by side,
 * "column" = stacked) with `sizes` as fractions parallel to `children`
 * (renormalised on heal). Splits always hold >= 2 children and never nest a
 * same-direction split (both canonicalised by `normalizeLayout`).
 *
 * The explicit `z.ZodType<PaneLayoutNode>` annotation is required: `z.lazy`
 * cannot infer a recursive type, and the annotation also keeps the tRPC-wire
 * inference on the client identical to this type (same concern as
 * `scrollState` below).
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
 * A pane: one content area inside a tab's split layout. Carries the tab
 * system's identity fields — what the pane shows. A single-pane tab (the
 * common case) has exactly one of these behind a bare-leaf layout.
 */
export const browserPaneSchema = z.object({
  id: z.string(),
  /** Tab whose layout tree this pane's leaf lives in. */
  tabId: z.string(),
  /**
   * Denormalised from the owning tab so window-scoped queries (identity dedup
   * on open) need no tab join. Invariant (healed): matches the tab's window.
   */
  windowId: z.string(),
  /** Canvas this pane shows. Null for a task pane or a blank pane. */
  dashboardId: z.string().nullable(),
  /** Task this pane shows. Null for a canvas pane or a blank pane. */
  taskId: z.string().nullable().default(null),
  channelId: z.string().nullable().default(null),
  /**
   * Channel sub-section this pane fronts (`artifacts` / `history` /
   * `context`). Null = the channel home, or a non-channel pane (canvas / task /
   * blank). Pairs with `channelId`: the two together identify a channel pane.
   */
  channelSection: z.string().nullable().default(null),
  /**
   * Top-level app page this pane shows (`inbox` / `agents` / `skills` /
   * `mcp-servers` / `command-center` / `home`). Null for a canvas / task /
   * channel / blank pane. These pages have no channel, task, or dashboard id,
   * so this is what lets them be a real pane target (label +
   * restore-on-refocus).
   */
  appView: z.string().nullable().default(null),
  /**
   * Reserved/unwired. Opaque per-pane state for future scroll restoration etc.
   * Plain `z.unknown()` (not `.default(null)`) so the inferred shape matches
   * the tRPC-wire inference on the client — keeps the renderer facade type and
   * the transport type identical.
   */
  scrollState: z.unknown().optional(),
  createdAt: z.number(),
  lastActiveAt: z.number(),
});
export type BrowserPane = z.infer<typeof browserPaneSchema>;

/**
 * A strip unit. The tab owns a pane layout: a bare leaf for the common
 * single-pane tab, a split tree after a merge. Identity lives on the panes;
 * the strip pill renders the focused pane's identity (plus a layout glyph
 * when split).
 */
export const browserTabSchema = z.object({
  id: z.string(),
  windowId: z.string(),
  /** Root of this tab's pane layout. A single-pane tab is a bare leaf. */
  layout: paneLayoutNodeSchema,
  /**
   * Pane that owns focus within this tab: keyboard shortcuts, the default
   * navigation target, the global back/forward buttons, and the pill's
   * label/icon all act on this pane. Invariant (healed): a leaf of `layout`.
   */
  focusedPaneId: z.string(),
  /** Gap-spaced ordering key within a window. Reindexed on collision. */
  position: z.number(),
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

export const browserWindowSchema = z.object({
  id: z.string(),
  isPrimary: z.boolean(),
  /** Saved geometry for session restore. Null on web / before first persist. */
  bounds: windowBoundsSchema.nullable().default(null),
  /** Which tab is focused in this window. Null = channels landing. */
  activeTabId: z.string().nullable().default(null),
});
export type BrowserWindow = z.infer<typeof browserWindowSchema>;

/** Full persisted snapshot, the source of truth held by TabsService. */
export const tabsSnapshotSchema = z.object({
  windows: z.array(browserWindowSchema),
  tabs: z.array(browserTabSchema),
  panes: z.array(browserPaneSchema),
});
export type TabsSnapshot = z.infer<typeof tabsSnapshotSchema>;
