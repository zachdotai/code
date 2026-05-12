import type {
  LogEntry,
  PermissionOption,
  TaskRun,
  TaskRunStatus,
} from "@posthog/core/types";

const STATUS_LABEL: Record<TaskRunStatus, string> = {
  not_started: "Not started",
  queued: "Queued",
  in_progress: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function printStatus(run: TaskRun): void {
  const label = STATUS_LABEL[run.status] ?? run.status;
  const parts = [`Status: ${label}`];
  if (run.stage) parts.push(`Stage: ${run.stage}`);
  if (run.branch) parts.push(`Branch: ${run.branch}`);
  if (run.error_message) parts.push(`Error: ${run.error_message}`);
  process.stdout.write(`${parts.join("  |  ")}\n`);
}

export function printRunHeader(taskId: string, runId: string): void {
  process.stdout.write(`Task: ${taskId}  Run: ${runId}\n`);
}

export function printTaskCreated(taskId: string, runId: string): void {
  process.stdout.write(`\nCloud task started.\n`);
  process.stdout.write(`  Task ID: ${taskId}\n`);
  process.stdout.write(`  Run ID:  ${runId}\n\n`);
  process.stdout.write(`Check status: posthog-code status ${taskId}\n`);
  process.stdout.write(`Watch live:   posthog-code status ${taskId} --watch\n`);
  process.stdout.write(
    `Interactive:  posthog-code status ${taskId} --interactive\n\n`,
  );
}

export function printLogEntry(entry: LogEntry): void {
  const method = entry.notification?.method;
  if (!method) return;

  const params = entry.notification?.params as
    | Record<string, unknown>
    | undefined;

  if (method === "session/update") {
    const update = params?.update as Record<string, unknown> | undefined;
    const sessionUpdate = update?.sessionUpdate as string | undefined;

    if (sessionUpdate === "agent_message") {
      const content = update?.content as
        | { type?: string; text?: string }
        | undefined;
      if (content?.type === "text" && content.text) {
        process.stdout.write(`${content.text}\n`);
      }
      return;
    }

    if (sessionUpdate === "agent_thought_chunk") {
      return;
    }

    return;
  }

  if (
    method === "_posthog/task_notification" ||
    method === "__posthog/task_notification"
  ) {
    const summary = params?.summary as string | undefined;
    if (summary) {
      process.stdout.write(`[task] ${summary}\n`);
    }
    return;
  }

  if (method === "_posthog/status" || method === "__posthog/status") {
    const status = params?.status as string | undefined;
    if (status && status !== "idle") {
      process.stdout.write(`[${status}]\n`);
    }
    return;
  }

  if (
    method === "_posthog/branch_created" ||
    method === "__posthog/branch_created"
  ) {
    const branch = params?.branch as string | undefined;
    if (branch) {
      process.stdout.write(`[branch] ${branch}\n`);
    }
    return;
  }

  if (method === "_posthog/error" || method === "__posthog/error") {
    const message = params?.message as string | undefined;
    if (message) {
      process.stderr.write(`[error] ${message}\n`);
    }
    return;
  }
}

export function printPermissionRequest(
  title: string,
  kind: string,
  options: PermissionOption[],
): void {
  process.stdout.write(`\n--- Permission required ---\n`);
  process.stdout.write(`${title} (${kind})\n`);
  options.forEach((opt, i) => {
    const desc = opt.description ? `  ${opt.description}` : "";
    process.stdout.write(`  [${i + 1}] ${opt.label}${desc}\n`);
  });
  process.stdout.write(`\n`);
}

export function printError(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
}

export function printLine(message: string): void {
  process.stdout.write(`${message}\n`);
}
