import { captureException } from "@utils/analytics";
import { logger } from "@utils/logger";

type SignalTriggerCommand = (label?: string) => string;

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
}

declare global {
  interface Window {
    __hedgemonyTriggerSignal?: SignalTriggerCommand;
  }
}
