import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { useService } from "@posthog/di/react";
import { DIFFS_HIGHLIGHTER_OPTIONS } from "@posthog/ui/features/sessions/diffHighlighterOptions";
import type { ReactNode } from "react";
import { DIFF_WORKER_FACTORY, type DiffWorkerFactory } from "./diffWorkerHost";

/**
 * Keeps the diff highlighter worker pool alive for the app's lifetime. The pool
 * is a singleton that the per-view providers (transcript, review) share, but it
 * self-terminates when the last of them unmounts — so navigating away from all
 * diff views and back re-pays the worker's one-time init (WASM regex engine +
 * theme normalization, ~1.7s). Mounting one provider at the root holds the
 * pool's mount count above zero, so that init happens once at startup and every
 * subsequent diff render reuses the warm worker.
 *
 * Uses the transcript's themes; languages load on demand, so the review
 * surface's eager lang preset is not needed for correctness.
 */
export function DiffWorkerPoolProvider({ children }: { children: ReactNode }) {
  const workerFactory = useService<DiffWorkerFactory>(DIFF_WORKER_FACTORY);
  return (
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory }}
      highlighterOptions={DIFFS_HIGHLIGHTER_OPTIONS}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
