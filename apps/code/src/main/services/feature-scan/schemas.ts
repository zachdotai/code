import { z } from "zod";

export const featureFolderSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
});

export const scanRepoResultSchema = z.object({
  folders: z.array(featureFolderSchema),
});

export const scanRepoInput = z.object({
  repoPath: z.string().min(1),
});

export type FeatureFolder = z.infer<typeof featureFolderSchema>;
export type ScanRepoResult = z.infer<typeof scanRepoResultSchema>;
export type ScanRepoInput = z.infer<typeof scanRepoInput>;
