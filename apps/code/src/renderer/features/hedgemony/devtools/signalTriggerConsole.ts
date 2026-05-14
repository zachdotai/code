import { reportKeys } from "@features/inbox/hooks/useInboxReports";
import { trpcClient } from "@renderer/trpc/client";
import type { SignalReport, SignalReportsResponse } from "@shared/types";
import { captureException } from "@utils/analytics";
import { logger } from "@utils/logger";
import { queryClient } from "@utils/queryClient";
import { SIGNAL_QUERY_PARAMS } from "../hooks/useSignalIngestion";

type SignalTriggerCommand = (label?: string) => string;
type SignalStubCommand = (
  taskId: string,
  options?: { title?: string; summary?: string },
) => Promise<{
  hogletId: string;
  taskId: string;
  signalReportId: string;
}>;

const log = logger.scope("hedgemony-signal-trigger");

/**
 * Fires a uniquely fingerprinted exception via PostHog so a brand-new error
 * tracking issue is created, which the signal pipeline then surfaces as a
 * fresh inbox report. Useful for exercising the hedgemony signal ingestion
 * path end-to-end in dev — the dev-only loosened filter in
 * `useSignalIngestion` picks the resulting report up within ~30s of the
 * report landing in `ready`/`in_progress`/`candidate` state.
 *
 * Note: `analytics.initializePostHog` sets `capture_exceptions: false` in dev,
 * but `posthog.captureException(...)` is an explicit call that bypasses that
 * gate and ships the event regardless. So this works in dev builds.
 */
export function registerHedgemonySignalTriggerConsoleCommand(): void {
  if (import.meta.env.PROD || typeof window === "undefined") {
    return;
  }
  if (typeof window.__hedgemonyTriggerSignal === "function") {
    return;
  }

  const command: SignalTriggerCommand = (label?: string) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tag = label?.trim() || "hedgemony-signal-trigger";
    const message = `${tag} ${stamp}`;
    const error = new Error(message);
    error.name = "HedgemonySignalTriggerError";
    captureException(error, { hedgemony_signal_trigger: true, tag, stamp });
    log.info("Fired test exception for signal ingestion", { message });
    return message;
  };

  Object.defineProperty(window, "__hedgemonyTriggerSignal", {
    value: command,
    configurable: true,
    writable: false,
  });

  if (typeof window.__hedgemonyStubSignal !== "function") {
    Object.defineProperty(window, "__hedgemonyStubSignal", {
      value: stubSignalCommand,
      configurable: true,
      writable: false,
    });
  }
}

/**
 * Synthesises a signal-backed hoglet without going through the real
 * pipeline. Takes an existing cloud-task id, mints a stub `SignalReport`,
 * seeds the inbox TanStack cache so `SignalHogletCard` can render title +
 * summary, then calls the `recordSignalBacked` mutation directly. The
 * watch subscription pushes the new hoglet into `useHogletStore`, where
 * it appears in the signal-staging bucket on the map.
 *
 * Skips:
 *   - The 30s ingestion poll (instant)
 *   - The artefact fetch (synthetic)
 *   - `taskService.createTask` (re-uses the task you pass in)
 *
 * Useful for verifying UI rendering / drag / dismiss without waiting for
 * the real signal pipeline. Pass any existing cloud task id — get it from
 * the URL of the task detail view, or `trpcClient.workspace.getAll.query()`
 * in the console.
 */
const stubSignalCommand: SignalStubCommand = async (taskId, options = {}) => {
  if (!taskId || typeof taskId !== "string") {
    throw new Error(
      "Usage: window.__hedgemonyStubSignal('<existing-task-id>', { title?, summary? })",
    );
  }

  const signalReportId = `stub-${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();
  const stubReport: SignalReport = {
    id: signalReportId,
    title: options.title ?? `Stub signal ${nowIso}`,
    summary:
      options.summary ??
      "Synthetic signal injected via window.__hedgemonyStubSignal — bypasses the real ingestion pipeline.",
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
  const existing = queryClient.getQueryData<SignalReportsResponse>(key);
  const merged: SignalReportsResponse = {
    results: [stubReport, ...(existing?.results ?? [])],
    count: (existing?.count ?? 0) + 1,
  };
  queryClient.setQueryData(key, merged);

  const hoglet = await trpcClient.hedgemony.hoglets.recordSignalBacked.mutate({
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
    __hedgemonyTriggerSignal?: SignalTriggerCommand;
    __hedgemonyStubSignal?: SignalStubCommand;
  }
}
