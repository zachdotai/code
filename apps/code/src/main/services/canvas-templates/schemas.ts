import { z } from "zod";

// What the create-picker needs to list templates (no heavy system prompt).
export const canvasTemplateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  builtIn: z.boolean(),
  suggestions: z.array(z.string()),
});
export type CanvasTemplateSummary = z.infer<typeof canvasTemplateSummarySchema>;

// The full template, including the agent system prompt.
export const canvasTemplateSchema = canvasTemplateSummarySchema.extend({
  systemPrompt: z.string(),
});
export type CanvasTemplate = z.infer<typeof canvasTemplateSchema>;

export const getCanvasTemplateInput = z.object({ id: z.string().min(1) });
export type GetCanvasTemplateInput = z.infer<typeof getCanvasTemplateInput>;
