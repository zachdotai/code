import { PostHogClient } from "@posthog/core/client";
import { loadConfig } from "@posthog/core/config";
import type {
  PermissionRequestEvent,
  TaskRunStateEvent,
} from "@posthog/core/types";
import { isTerminalStatus } from "@posthog/core/types";
import {
  printError,
  printLine,
  printLogEntry,
  printTaskCreated,
} from "../display.ts";

export interface StartOptions {
  repo?: string;
  watch: boolean;
}

export async function runStart(
  prompt: string,
  options: StartOptions,
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
    printLine("Creating task...");
    const task = await client.createTask({
      description: prompt,
      repository: options.repo,
    });

    printLine("Creating run...");
    const run = await client.createTaskRun(task.id);

    printLine("Starting cloud execution...");
    await client.startTaskRun(task.id, run.id, {
      pendingUserMessage: prompt,
    });

    printTaskCreated(task.id, run.id);

    if (options.watch) {
      await watchRun(client, task.id, run.id, { interactive: false });
    }
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function watchRun(
  client: PostHogClient,
  taskId: string,
  runId: string,
  options: { interactive: boolean },
): Promise<void> {
  const abortController = new AbortController();

  process.on("SIGINT", () => {
    printLine("\nInterrupted — task continues running in the cloud.");
    abortController.abort();
  });

  let lastStatus: string | null = null;

  const handleStatus = (event: TaskRunStateEvent): void => {
    if (event.status && event.status !== lastStatus) {
      lastStatus = event.status;
      const parts = [`[status] ${event.status}`];
      if (event.stage) parts.push(`stage: ${event.stage}`);
      if (event.branch) parts.push(`branch: ${event.branch}`);
      printLine(parts.join("  "));

      if (isTerminalStatus(event.status)) {
        abortController.abort();
      }
    }
  };

  const handlePermission = options.interactive
    ? (event: PermissionRequestEvent) =>
        handlePermissionInteractive(
          client,
          taskId,
          runId,
          event,
          abortController,
        )
    : undefined;

  try {
    await client.streamEvents(
      taskId,
      runId,
      {
        onStatus: handleStatus,
        onLogEntry: printLogEntry,
        onPermissionRequest: handlePermission,
      },
      abortController.signal,
    );
  } catch (err: unknown) {
    if (isAbortError(err)) return;
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function handlePermissionInteractive(
  client: PostHogClient,
  taskId: string,
  runId: string,
  event: PermissionRequestEvent,
  abortController: AbortController,
): Promise<void> {
  const { requestId, toolCall, options } = event;
  const isQuestion = toolCall._meta?.codeToolKind === "question";

  if (isQuestion) {
    await handleQuestion(client, taskId, runId, event);
    return;
  }

  process.stdout.write(`\n--- Permission required ---\n`);
  process.stdout.write(`${toolCall.title} (${toolCall.kind})\n`);
  options.forEach((opt, i) => {
    process.stdout.write(`  [${i + 1}] ${opt.label}\n`);
  });
  process.stdout.write("\nChoose [1");
  if (options.length > 1) process.stdout.write(`-${options.length}`);
  process.stdout.write("]: ");

  const choice = await readLineFromStdin();
  const index = Number.parseInt(choice.trim(), 10) - 1;
  const selected = options[index] ?? options[0];

  const result = await client.sendCommand(taskId, runId, {
    method: "permission_response",
    params: { requestId, optionId: selected.optionId },
  });

  if (!result.success) {
    printError(`Failed to respond to permission: ${result.error ?? "unknown"}`);
  }

  if (isTerminalStatus(null)) {
    abortController.abort();
  }
}

async function handleQuestion(
  client: PostHogClient,
  taskId: string,
  runId: string,
  event: PermissionRequestEvent,
): Promise<void> {
  const { requestId, options } = event;
  const meta = event.toolCall._meta as Record<string, unknown> | undefined;
  const questions = meta?.questions as
    | Array<{ question: string; options: Array<{ label: string }> }>
    | undefined;

  const answers: Record<string, string> = {};

  if (questions?.length) {
    for (const q of questions) {
      process.stdout.write(`\n${q.question}\n`);
      q.options.forEach((opt, i) => {
        process.stdout.write(`  [${i + 1}] ${opt.label}\n`);
      });
      process.stdout.write("\nChoose: ");
      const choice = await readLineFromStdin();
      const index = Number.parseInt(choice.trim(), 10) - 1;
      const selected = q.options[index] ?? q.options[0];
      answers[q.question] = selected.label;
    }
  }

  const allowOption = options.find(
    (o) => o.kind === "allow_once" || o.kind === "allow_always",
  );
  const optionId = allowOption?.optionId ?? options[0].optionId;

  const result = await client.sendCommand(taskId, runId, {
    method: "permission_response",
    params: { requestId, optionId, answers },
  });

  if (!result.success) {
    printError(`Failed to respond to question: ${result.error ?? "unknown"}`);
  }
}

function readLineFromStdin(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let input = "";
    const onData = (chunk: string): void => {
      input += chunk;
      const newlineIndex = input.indexOf("\n");
      if (newlineIndex !== -1) {
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        resolve(input.slice(0, newlineIndex));
      }
    };

    process.stdin.on("data", onData);
  });
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.message.includes("aborted"))
  );
}

export { isAbortError, readLineFromStdin };
