import { z } from "zod";

export const fetchS3LogsInput = z.object({ logUrl: z.string().min(1) });
export const fetchS3LogsOutput = z.string().nullable();

export const readLocalLogsInput = z.object({ taskRunId: z.string().min(1) });
export const readLocalLogsOutput = z.string().nullable();

export const readLocalLogsWindowInput = z.object({
  taskRunId: z.string().min(1),
  endOffset: z.number().int().nonnegative().nullable(),
  maxBytes: z.number().int().positive(),
});
export const readLocalLogsWindowOutput = z
  .object({
    content: z.string(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
    headReached: z.boolean(),
  })
  .nullable();

export const writeLocalLogsInput = z.object({
  taskRunId: z.string().min(1),
  content: z.string(),
});

export const seedLocalLogsInput = z.object({
  taskRunId: z.string().min(1),
  content: z.string(),
});

export const countLocalLogEntriesInput = z.object({
  taskRunId: z.string().min(1),
});
export const countLocalLogEntriesOutput = z.number();

export const deleteLocalLogCacheInput = z.object({
  taskRunId: z.string().min(1),
});
