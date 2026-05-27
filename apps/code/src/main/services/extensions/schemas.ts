import type {
  ExtensionChangedPayload,
  ExtensionCommandContribution,
  ExtensionInfo,
  ExtensionPromptContribution,
  ExtensionSidebarContribution,
  ExtensionToolContribution,
} from "@shared/types/extensions";
import { z } from "zod";

export const extensionCommandContributionSchema: z.ZodType<ExtensionCommandContribution> =
  z.object({
    extensionId: z.string(),
    name: z.string(),
    description: z.string(),
    input: z.object({ hint: z.string() }).optional(),
  });

export const extensionPromptContributionSchema: z.ZodType<ExtensionPromptContribution> =
  z.object({
    extensionId: z.string(),
    name: z.string(),
    description: z.string(),
    input: z.object({ hint: z.string() }).optional(),
  });

export const extensionToolContributionSchema: z.ZodType<ExtensionToolContribution> =
  z.object({
    extensionId: z.string(),
    name: z.string(),
    description: z.string(),
  });

export const extensionSidebarContributionSchema: z.ZodType<ExtensionSidebarContribution> =
  z.object({
    extensionId: z.string(),
    id: z.string(),
    title: z.string(),
    icon: z.string().optional(),
    entry: z.string().optional(),
    url: z.string().optional(),
    html: z.string().optional(),
  });

export const extensionInfoSchema: z.ZodType<ExtensionInfo> = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  version: z.string(),
  description: z.string().optional(),
  installPath: z.string(),
  commands: z.array(extensionCommandContributionSchema),
  prompts: z.array(extensionPromptContributionSchema),
  tools: z.array(extensionToolContributionSchema).optional(),
  sidebar: z.array(extensionSidebarContributionSchema),
  skillCount: z.number(),
  loadErrors: z.array(z.string()),
});

export const listExtensionsOutput = z.array(extensionInfoSchema);

export const listExtensionCommandsOutput = z.array(
  extensionCommandContributionSchema,
);

export const listExtensionPromptsOutput = z.array(
  extensionPromptContributionSchema,
);

export const listExtensionSidebarOutput = z.array(
  extensionSidebarContributionSchema,
);

export const installExtensionInput = z.object({
  zipPath: z.string(),
});

export const uninstallExtensionInput = z.object({
  extensionId: z.string(),
});

export const executeExtensionCommandInput = z.object({
  name: z.string(),
  args: z.string().optional(),
  taskId: z.string().optional(),
  repoPath: z.string().nullable().optional(),
});

export const executeExtensionCommandOutput = z.object({
  handled: z.boolean(),
  message: z.string().optional(),
  prompt: z.string().optional(),
});

export const extensionChangedOutput: z.ZodType<ExtensionChangedPayload> =
  z.object({
    extensions: listExtensionsOutput,
  });
