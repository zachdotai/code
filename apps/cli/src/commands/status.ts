import { PostHogClient, resolveRunId } from "@posthog/core/client";
import { loadConfig } from "@posthog/core/config";
import { isTerminalStatus } from "@posthog/core/types";
import {
  printError,
  printLine,
  printLogEntry,
  printRunHeader,
  printStatus,
} from "../display.ts";
import { isAbortError, watchRun } from "./start.ts";

export interface StatusOptions {
  runId?: string;
  watch: boolean;
  interactive: boolean;
}

export async function runStatus(
  taskId: string,
  options: StatusOptions,
): Promise<void> {
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig();
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const client = new PostHogClient(config);

  try {
    let runId = options.runId;

    if (!runId) {
      const task = await client.getTask(taskId);
      runId = resolveRunId(task);
      if (!runId) {
        printError("No run found for this task. Has it been started?");
        process.exit(1);
      }
    }

    if (options.watch || options.interactive) {
      printRunHeader(taskId, runId);
      await watchRun(client, taskId, runId, {
        interactive: options.interactive,
      });
      return;
    }

    const run = await client.getTaskRun(taskId, runId);
    printRunHeader(taskId, run.id);
    printStatus(run);

    if (isTerminalStatus(run.status)) {
      const logs = await client.fetchLogs(taskId, run.id);
      if (logs.length > 0) {
        printLine("\n--- Recent activity ---");
        for (const entry of logs.slice(-20)) {
          printLogEntry(entry);
        }
      }
    }
  } catch (err: unknown) {
    if (isAbortError(err)) return;
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
