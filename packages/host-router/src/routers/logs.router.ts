import { publicProcedure, router } from "@posthog/host-trpc/trpc";
import type { ILogsService } from "@posthog/workspace-server/services/local-logs/identifiers";
import { LOGS_SERVICE } from "@posthog/workspace-server/services/local-logs/identifiers";
import {
  fetchS3LogsInput,
  fetchS3LogsOutput,
  readLocalLogsInput,
  readLocalLogsOutput,
  readLocalLogsWindowInput,
  readLocalLogsWindowOutput,
  writeLocalLogsInput,
} from "@posthog/workspace-server/services/local-logs/schemas";

export const logsRouter = router({
  fetchS3Logs: publicProcedure
    .input(fetchS3LogsInput)
    .output(fetchS3LogsOutput)
    .query(({ ctx, input }) =>
      ctx.container.get<ILogsService>(LOGS_SERVICE).fetchS3Logs(input.logUrl),
    ),

  readLocalLogs: publicProcedure
    .input(readLocalLogsInput)
    .output(readLocalLogsOutput)
    .query(({ ctx, input }) =>
      ctx.container
        .get<ILogsService>(LOGS_SERVICE)
        .readLocalLogs(input.taskRunId),
    ),

  readLocalLogsWindow: publicProcedure
    .input(readLocalLogsWindowInput)
    .output(readLocalLogsWindowOutput)
    .query(({ ctx, input }) =>
      ctx.container
        .get<ILogsService>(LOGS_SERVICE)
        .readLocalLogsWindow(input.taskRunId, input.endOffset, input.maxBytes),
    ),

  writeLocalLogs: publicProcedure
    .input(writeLocalLogsInput)
    .mutation(({ ctx, input }) =>
      ctx.container
        .get<ILogsService>(LOGS_SERVICE)
        .writeLocalLogs(input.taskRunId, input.content),
    ),
});
