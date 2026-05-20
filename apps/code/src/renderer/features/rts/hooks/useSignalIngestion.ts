import { trpcClient } from "@renderer/trpc/client";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { useEffect } from "react";
import { playVoice } from "../audio/voice";

const log = logger.scope("signal-ingestion");

// Exported for parity with the legacy hook: dev devtools (and other code that
// pre-seeded the inbox TanStack cache used by SignalHogletCard) still read
// from this key. The orchestration itself now lives in the main-process
// `SignalIngestionService`, so this object isn't used to drive any hook here.
export const SIGNAL_QUERY_PARAMS = {
  status: import.meta.env.DEV
    ? ("ready,in_progress,candidate" as const)
    : ("needs_review" as const),
  ordering: "-created_at" as const,
  limit: 50,
};

/**
 * Kicks the main-process signal ingestion poll loop and subscribes to its
 * `hogletIngested` event stream so renderer-only side-effects (arrival voice,
 * analytics) fire when a new signal-backed hoglet appears. The poll loop
 * itself — fetching signals, building prompts, creating cloud Tasks, writing
 * the local sidecar — lives in main and survives this hook unmounting.
 *
 * `start` is idempotent. The hook intentionally does NOT call `cancel` on
 * unmount: ingestion is a global side-effect, not a per-view concern, and
 * stopping it the moment the operator navigates away from the map would
 * race with in-flight cloud Task creation.
 */
export function useSignalIngestion(): void {
  useEffect(() => {
    trpcClient.hedgemony.signalIngestion.start
      .mutate()
      .catch((error: unknown) =>
        log.error("Failed to start signal ingestion service", { error }),
      );

    const sub = trpcClient.hedgemony.signalIngestion.onIngested.subscribe(
      undefined,
      {
        onData: (payload) => {
          playVoice("system:signal_arrived");
          track(ANALYTICS_EVENTS.HEDGEMONY_HOGLET_INGESTED, {
            source: "signal",
          });
          log.info("Signal-backed hoglet ingested", payload);
        },
        onError: (error) => {
          log.warn("Signal ingestion event subscription error", { error });
        },
      },
    );
    return () => sub.unsubscribe();
  }, []);
}
