import { resolveService } from "@posthog/di/container";
import type {
  SignalReport,
  SignalReportsResponse,
} from "@posthog/shared/domain-types";
import { reportKeys } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { captureException } from "@posthog/ui/shell/analytics";
import { logger } from "@posthog/ui/shell/logger";
import {
  IMPERATIVE_QUERY_CLIENT,
  type ImperativeQueryClient,
} from "@posthog/ui/shell/queryClient";
import { SIGNAL_QUERY_PARAMS } from "../hooks/useSignalIngestion";
import { hostClient } from "../hostClient";

function queryClientInstance(): ImperativeQueryClient {
  return resolveService<ImperativeQueryClient>(IMPERATIVE_QUERY_CLIENT);
}

type SignalTriggerCommand = (label?: string) => string;
type SignalStubCommand = (
  taskId: string,
  options?: { title?: string; summary?: string },
) => Promise<{
  hogletId: string;
  taskId: string;
  signalReportId: string;
}>;
type ListTasksCommand = () => Promise<Array<{ id: string; title: string }>>;

const log = logger.scope("rts-signal-trigger");

/**
 * Fires a uniquely fingerprinted exception via PostHog so a brand-new error
 * tracking issue is created, which the signal pipeline then surfaces as a
 * fresh inbox report. Useful for exercising the RTS mode signal ingestion
 * path end-to-end in dev — the dev-only loosened filter in
 * `useSignalIngestion` picks the resulting report up within ~30s of the
 * report landing in `ready`/`in_progress`/`candidate` state.
 *
 * Note: `analytics.initializePostHog` sets `capture_exceptions: false` in dev,
 * but `posthog.captureException(...)` is an explicit call that bypasses that
 * gate and ships the event regardless. So this works in dev builds.
 */
export function registerRtsSignalTriggerConsoleCommand(): void {
  if (import.meta.env.PROD || typeof window === "undefined") {
    return;
  }
  if (typeof window.__rtsTriggerSignal === "function") {
    return;
  }

  const command: SignalTriggerCommand = (label?: string) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tag = label?.trim() || "rts-signal-trigger";
    const message = `${tag} ${stamp}`;
    const error = new Error(message);
    error.name = "RtsSignalTriggerError";
    captureException(error, { rts_signal_trigger: true, tag, stamp });
    log.info("Fired test exception for signal ingestion", { message });
    return message;
  };

  Object.defineProperty(window, "__rtsTriggerSignal", {
    value: command,
    configurable: true,
    writable: false,
  });

  if (typeof window.__rtsStubSignal !== "function") {
    Object.defineProperty(window, "__rtsStubSignal", {
      value: stubSignalCommand,
      configurable: true,
      writable: false,
    });
  }

  if (typeof window.__rtsListTasks !== "function") {
    Object.defineProperty(window, "__rtsListTasks", {
      value: listTasksCommand,
      configurable: true,
      writable: false,
    });
  }
}

const listTasksCommand: ListTasksCommand = async () => {
  // Task titles live in the REST-backed TanStack Query cache (see useTasks /
  // useTaskSummaries — keyed off `["tasks", ...]`). We pull from cache rather
  // than hitting the API so this works without auth juggling.
  const entries = queryClientInstance().getQueriesData<unknown>({
    queryKey: ["tasks"],
  });
  const seen = new Map<string, string>();
  for (const [, data] of entries) {
    const items = Array.isArray(data) ? data : [];
    for (const item of items) {
      if (
        item &&
        typeof item === "object" &&
        "id" in item &&
        "title" in item &&
        typeof (item as { id: unknown }).id === "string" &&
        typeof (item as { title: unknown }).title === "string"
      ) {
        const { id, title } = item as { id: string; title: string };
        if (!seen.has(id)) seen.set(id, title);
      }
    }
  }
  const rows = Array.from(seen, ([id, title]) => ({ id, title }));
  if (rows.length === 0) {
    log.warn(
      "No tasks in the React Query cache yet. Open the sidebar (which fetches task summaries) and try again.",
    );
  }
  return rows;
};

/**
 * Synthesises a signal-backed hoglet without going through the real
 * pipeline. Takes an existing cloud-task id, mints a stub `SignalReport`,
 * seeds the inbox TanStack cache so on-map sprites and detail panels can
 * resolve title + summary, then calls the `recordSignalBacked` mutation
 * directly. The watch subscription pushes the new hoglet into
 * `useHogletStore`, where it appears as a robot wild hoglet on the map
 * (or inside a nest if the affinity router auto-routes it).
 *
 * Skips:
 *   - The 30s ingestion poll (instant)
 *   - The artefact fetch (synthetic)
 *   - `taskService.createTask` (re-uses the task you pass in)
 *
 * Useful for verifying UI rendering / drag without waiting for the real
 * signal pipeline. Pass any existing cloud task id — get a list via
 * `window.__rtsListTasks()` in the console.
 */
const stubSignalCommand: SignalStubCommand = async (taskId, options = {}) => {
  if (!taskId || typeof taskId !== "string") {
    throw new Error(
      "Usage: window.__rtsStubSignal('<existing-task-id>', { title?, summary? })",
    );
  }

  const signalReportId = `stub-${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();
  const stubReport: SignalReport = {
    id: signalReportId,
    title: options.title ?? `Stub signal ${nowIso}`,
    summary:
      options.summary ??
      "Synthetic signal injected via window.__rtsStubSignal — bypasses the real ingestion pipeline.",
    status: "ready",
    total_weight: 1,
    signal_count: 1,
    created_at: nowIso,
    updated_at: nowIso,
    artefact_count: 0,
  };

  // Prepend the stub to whatever the hook has already cached so the card
  // can resolve title/summary by id. `useSignalIngestion` and
  // `SignalHogletCard` both read from `SIGNAL_QUERY_PARAMS`'s key.
  const key = reportKeys.list(SIGNAL_QUERY_PARAMS);
  const existing =
    queryClientInstance().getQueryData<SignalReportsResponse>(key);
  const merged: SignalReportsResponse = {
    results: [stubReport, ...(existing?.results ?? [])],
    count: (existing?.count ?? 0) + 1,
  };
  queryClientInstance().setQueryData(key, merged);

  const hoglet = await hostClient().rts.hoglets.recordSignalBacked.mutate({
    taskId,
    signalReportId,
  });
  log.info("Stubbed signal hoglet", {
    hogletId: hoglet.id,
    taskId,
    signalReportId,
  });
  return { hogletId: hoglet.id, taskId, signalReportId };
};

declare global {
  interface Window {
    __rtsTriggerSignal?: SignalTriggerCommand;
    __rtsStubSignal?: SignalStubCommand;
    __rtsListTasks?: ListTasksCommand;
  }
}
