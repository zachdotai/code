import {
  createProjectInput,
  gridSize,
  newTileInput,
  projectIconId,
  tileSize,
  workProject,
} from "@shared/types/work-projects";
import { z } from "zod";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import type { WorkProjectsService } from "../../services/work-projects/service";
import {
  getTemplateById,
  PROJECT_TEMPLATES,
} from "../../services/work-projects/templates";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<WorkProjectsService>(MAIN_TOKENS.WorkProjectsService);

const templateCategory = z.enum([
  "growth",
  "engineering",
  "product",
  "ops",
  "research",
]);

const projectTemplateSummary = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string(),
  iconId: projectIconId,
  category: templateCategory,
  description: z.string(),
  tileCount: z.number().int().nonnegative(),
});

export const workProjectsRouter = router({
  list: publicProcedure.output(z.array(workProject)).query(() => {
    return getService().list();
  }),

  get: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .output(workProject.nullable())
    .query(({ input }) => {
      return getService().get(input.projectId);
    }),

  create: publicProcedure
    .input(createProjectInput)
    .output(workProject)
    .mutation(async ({ input }) => {
      return getService().create(input);
    }),

  clearNextSteps: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().clearNextSteps(input.projectId);
    }),

  delete: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(({ input }) => {
      getService().delete(input.projectId);
      return { ok: true };
    }),

  softDelete: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().softDelete(input.projectId);
    }),

  undoDelete: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().undoDelete(input.projectId);
    }),

  commitDelete: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(({ input }) => {
      getService().commitDelete(input.projectId);
      return { ok: true };
    }),

  pin: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().pinProject(input.projectId);
    }),

  unpin: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().unpinProject(input.projectId);
    }),

  listTemplates: publicProcedure
    .output(z.array(projectTemplateSummary))
    .query(() => {
      return PROJECT_TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        tagline: t.tagline,
        iconId: t.iconId,
        category: t.category,
        description: t.description,
        tileCount: t.tiles.length,
      }));
    }),

  createFromTemplate: publicProcedure
    .input(z.object({ templateId: z.string() }))
    .output(workProject)
    .mutation(({ input }) => {
      const template = getTemplateById(input.templateId);
      if (!template) {
        throw new Error(`Unknown template: ${input.templateId}`);
      }
      return getService().createFromTemplate({
        name: template.name,
        tagline: template.tagline,
        iconId: template.iconId,
        tiles: template.tiles,
        openingPrompt: template.openingPrompt,
      });
    }),

  clearPendingPrompt: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().clearPendingPrompt(input.projectId);
    }),

  addTile: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        tile: newTileInput,
        state: z.enum(["live", "pending_add"]).optional().default("live"),
        origin: z.enum(["user", "chat"]).optional().default("user"),
      }),
    )
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().addTile(input.projectId, input.tile, {
        state: input.state,
        origin: input.origin,
      });
    }),

  removeTile: publicProcedure
    .input(z.object({ projectId: z.string(), tileId: z.string() }))
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().removeTile(input.projectId, input.tileId);
    }),

  resizeTile: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        tileId: z.string(),
        size: tileSize,
      }),
    )
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().updateTileSize(
        input.projectId,
        input.tileId,
        input.size,
      );
    }),

  resizeTileGrid: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        tileId: z.string(),
        gridSize,
      }),
    )
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().updateTileGridSize(
        input.projectId,
        input.tileId,
        input.gridSize,
      );
    }),

  updateChecklistTile: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        tileId: z.string(),
        items: z.array(
          z.object({
            text: z.string(),
            done: z.boolean(),
          }),
        ),
      }),
    )
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().updateChecklistTile(
        input.projectId,
        input.tileId,
        input.items,
      );
    }),

  moveTile: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        tileId: z.string(),
        toIndex: z.number().int().min(0),
      }),
    )
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().moveTile(
        input.projectId,
        input.tileId,
        input.toIndex,
      );
    }),

  updateTitleTile: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().optional(),
        tagline: z.string().optional(),
        iconId: projectIconId.optional(),
      }),
    )
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().updateTitleTile(input.projectId, {
        name: input.name,
        tagline: input.tagline,
        iconId: input.iconId,
      });
    }),

  updateNoteTile: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        tileId: z.string(),
        body: z.string().optional(),
        tone: z.enum(["yellow", "blue", "green", "pink", "neutral"]).optional(),
      }),
    )
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().updateNoteTile(input.projectId, input.tileId, {
        body: input.body,
        tone: input.tone,
      });
    }),

  updateFileTile: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        tileId: z.string(),
        filename: z.string().optional(),
        contents: z.string().optional(),
      }),
    )
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().updateFileTile(input.projectId, input.tileId, {
        filename: input.filename,
        contents: input.contents,
      });
    }),

  applyPendingTile: publicProcedure
    .input(z.object({ projectId: z.string(), tileId: z.string() }))
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().applyPending(input.projectId, input.tileId);
    }),

  rejectPendingTile: publicProcedure
    .input(z.object({ projectId: z.string(), tileId: z.string() }))
    .output(workProject.nullable())
    .mutation(({ input }) => {
      return getService().rejectPending(input.projectId, input.tileId);
    }),

  onProjectChanged: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .subscription(async function* (opts) {
      const service = getService();
      for await (const data of service.toIterable("project-changed", {
        signal: opts.signal,
      })) {
        if (data.projectId === opts.input.projectId) {
          yield data;
        }
      }
    }),

  onProjectsChanged: publicProcedure.subscription(async function* (opts) {
    const service = getService();
    for await (const _data of service.toIterable("projects-changed", {
      signal: opts.signal,
    })) {
      yield true as const;
    }
  }),
});
