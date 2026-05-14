import { z } from "zod";

/**
 * Project canvas types. A project's left-pane "artifact" is a composable bento
 * grid of tiles. Tiles are owned by the main process (persisted in
 * electron-store) and rendered in the renderer. A chat panel on the right of
 * the canvas can propose tile mutations as ghost tiles which the user accepts
 * or rejects.
 */

export const projectIconId = z.enum([
  "rocket",
  "microphone",
  "megaphone",
  "lightbulb",
  "compass",
  "target",
  "flask",
]);
export type ProjectIconId = z.infer<typeof projectIconId>;

export const tileSize = z.enum(["sm", "md", "lg", "full"]);
export type TileSize = z.infer<typeof tileSize>;

/** Snap-to-grid sizing. cols 1..12, rows 1..4. When set, takes precedence
 *  over the legacy `size` enum. The renderer derives grid-column-span and
 *  grid-row-span CSS from this. */
export const gridSize = z.object({
  cols: z.number().int().min(1).max(12),
  rows: z.number().int().min(1).max(4),
});
export type GridSize = z.infer<typeof gridSize>;

export const tileState = z.enum([
  "live",
  "pending_add",
  "pending_remove",
  "pending_edit",
]);
export type TileState = z.infer<typeof tileState>;

export const tileOrigin = z.enum(["seed", "user", "chat"]);
export type TileOrigin = z.infer<typeof tileOrigin>;

const tileBase = z.object({
  id: z.string(),
  size: tileSize,
  state: tileState,
  origin: tileOrigin,
  gridSize: gridSize.optional(),
});

export const titleTile = tileBase.extend({
  type: z.literal("title"),
  iconId: projectIconId,
  name: z.string(),
  tagline: z.string(),
});
export type TitleTile = z.infer<typeof titleTile>;

const trendsQueryBody = z.record(z.string(), z.unknown());

export const headlineTile = tileBase.extend({
  type: z.literal("headline"),
  label: z.string(),
  /** Display label for the live mode, falls back to `label` when absent. */
  liveLabel: z.string().optional(),
  /** Fallback values shown pre-auth or while the query is loading. */
  fallbackValue: z.string(),
  fallbackDelta: z.string(),
  fallbackSparkline: z.array(z.number()),
  /** PostHog `/query/` body. When omitted the tile renders the fallback. */
  query: z
    .object({
      posthogProjectId: z.number(),
      body: trendsQueryBody,
    })
    .optional(),
  posthogUrl: z.string().optional(),
});
export type HeadlineTile = z.infer<typeof headlineTile>;

export const insightTile = tileBase.extend({
  type: z.literal("insight"),
  /** Either a dashboard or an insight reference. */
  posthogProjectId: z.number(),
  dashboardId: z.number().optional(),
  insightId: z.number().optional(),
  shortId: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  owner: z.string().optional(),
  url: z.string(),
});
export type InsightTile = z.infer<typeof insightTile>;

export const fileTile = tileBase.extend({
  type: z.literal("file"),
  filename: z.string(),
  contents: z.string(),
});
export type FileTile = z.infer<typeof fileTile>;

export const skillOutputTile = tileBase.extend({
  type: z.literal("skill_output"),
  skillName: z.string(),
  skillDescription: z.string().optional(),
  lastRunOutput: z.string().optional(),
  lastRunAt: z.string().optional(),
});
export type SkillOutputTile = z.infer<typeof skillOutputTile>;

export const noteTile = tileBase.extend({
  type: z.literal("note"),
  body: z.string(),
  /** Visual tone for the sticky-note background. */
  tone: z
    .enum(["yellow", "blue", "green", "pink", "neutral"])
    .default("yellow"),
});
export type NoteTile = z.infer<typeof noteTile>;

/** Artifact tile — a single tile type whose `kind` selects the renderer.
 *  The data payload is per-kind and loosely typed at the schema layer; the
 *  renderer is defensive when reading it. Lets the agent (and skills) create
 *  rich tile content without growing the discriminated union. */
export const artifactKind = z.enum([
  "checklist",
  "table",
  "chart",
  "code",
  "embed",
]);
export type ArtifactKind = z.infer<typeof artifactKind>;

export const artifactTile = tileBase.extend({
  type: z.literal("artifact"),
  kind: artifactKind,
  title: z.string().max(80),
  /** Per-kind payload. Shapes documented in the MCP tool description and in
   *  the renderer's per-kind components. */
  data: z.record(z.string(), z.unknown()),
});
export type ArtifactTile = z.infer<typeof artifactTile>;

export const tile = z.discriminatedUnion("type", [
  titleTile,
  headlineTile,
  insightTile,
  fileTile,
  skillOutputTile,
  noteTile,
  artifactTile,
]);
export type Tile = z.infer<typeof tile>;
export type TileType = Tile["type"];

export const projectMember = z.object({
  name: z.string(),
  initials: z.string(),
});
export type ProjectMember = z.infer<typeof projectMember>;

export const workProject = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string(),
  iconId: projectIconId,
  members: z.array(projectMember),
  tiles: z.array(tile),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Starter prompt to auto-fire as the first chat message when the project's
   *  chat panel mounts. Cleared by the renderer once the chat has been kicked
   *  off so it never replays. */
  pendingPrompt: z.string().optional(),
  /** Suggested next-step prompts the agent sets at the end of each turn via
   *  the `set_next_steps` canvas tool. The renderer renders these as clickable
   *  chips below the chat. Replaced each turn. */
  nextSteps: z.array(z.string()).optional(),
  /** ISO timestamp when the user pinned the project. Sortable. When set, the
   *  project appears in the sidebar's pinned subtree and the home "Pinned"
   *  rail. */
  pinnedAt: z.string().optional(),
  /** ISO timestamp set when the user triggers a delete with undo. While set,
   *  the project is hidden from `list()` and from project-changed
   *  subscriptions. After the undo grace period elapses (handled by the
   *  renderer toast), the project is hard-committed via `commitDelete`. On
   *  app boot, any project with `pendingDeletionAt` older than 30s is
   *  auto-committed (recovery from crashes during the grace window). */
  pendingDeletionAt: z.string().optional(),
});
export type WorkProject = z.infer<typeof workProject>;

/** Patch shape used by add-tile mutations. The caller passes the type-specific
 *  fields; the service assigns an id, state, origin, and a default size. */
export const newTileInput = z.discriminatedUnion("type", [
  titleTile.omit({ id: true, state: true, origin: true, size: true }).extend({
    size: tileSize.optional(),
  }),
  headlineTile
    .omit({ id: true, state: true, origin: true, size: true })
    .extend({
      size: tileSize.optional(),
    }),
  insightTile.omit({ id: true, state: true, origin: true, size: true }).extend({
    size: tileSize.optional(),
  }),
  fileTile.omit({ id: true, state: true, origin: true, size: true }).extend({
    size: tileSize.optional(),
  }),
  skillOutputTile
    .omit({ id: true, state: true, origin: true, size: true })
    .extend({
      size: tileSize.optional(),
    }),
  noteTile.omit({ id: true, state: true, origin: true, size: true }).extend({
    size: tileSize.optional(),
  }),
  artifactTile
    .omit({ id: true, state: true, origin: true, size: true })
    .extend({
      size: tileSize.optional(),
    }),
]);
export type NewTileInput = z.infer<typeof newTileInput>;

export const createProjectInput = z.object({
  name: z.string().optional(),
  tagline: z.string().optional(),
  iconId: projectIconId.optional(),
  fromPrompt: z.string().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInput>;

export const tileSizeChange = z.object({
  tileId: z.string(),
  size: tileSize,
});

export const tileMove = z.object({
  tileId: z.string(),
  toIndex: z.number().int().min(0),
});

export type WorkProjectsEvents = {
  "project-changed": { projectId: string };
  "projects-changed": undefined;
};
