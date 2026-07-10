import type { IChannelsService } from "@posthog/core/channels/channels";
import { CHANNELS_SERVICE } from "@posthog/core/channels/identifiers";
import {
  channelTaskIdInput,
  channelTaskRecordSchema,
  fileChannelTaskInput,
  listChannelTasksInput,
} from "@posthog/core/channels/schemas";
import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import { z } from "zod";

export const channelTasksRouter = router({
  list: publicProcedure
    .input(listChannelTasksInput)
    .output(z.array(channelTaskRecordSchema))
    .query(({ ctx, input }) =>
      ctx.container
        .get<IChannelsService>(CHANNELS_SERVICE)
        .listTasks(input.channelId),
    ),
  file: publicProcedure
    .input(fileChannelTaskInput)
    .output(channelTaskRecordSchema)
    .mutation(({ ctx, input }) =>
      ctx.container.get<IChannelsService>(CHANNELS_SERVICE).fileTask(input),
    ),
  unfile: publicProcedure
    .input(channelTaskIdInput)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<IChannelsService>(CHANNELS_SERVICE)
        .unfileTask(input.id),
    ),
});
