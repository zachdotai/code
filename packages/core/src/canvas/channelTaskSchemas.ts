import { z } from "zod";

export const channelTaskRecordSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  taskId: z.string(),
  createdAt: z.number(),
});
export type ChannelTaskRecord = z.infer<typeof channelTaskRecordSchema>;

export const listChannelTasksInput = z.object({
  channelId: z.string().min(1),
  // The channel folder's file-system path, if the caller already knows it (it
  // rides on the channel row from `useChannels`). Lets the service skip the
  // extra getEntry round-trip that resolves channelId → path. Optional so older
  // callers and tests still work; the service falls back to resolving it.
  channelPath: z.string().optional(),
});

export const fileChannelTaskInput = z.object({
  channelId: z.string().min(1),
  taskId: z.string().min(1),
  taskTitle: z.string().min(1),
});

export const channelTaskIdInput = z.object({ id: z.string().min(1) });
