import { useIsOnline, useOutboxEntries } from "./useLocalFirstStatus";

/**
 * Offline affordance for the local-first store: reads keep working from local
 * data, queued writes wait for reconnect — this banner just makes that state
 * visible instead of silent.
 */
export function LocalFirstStatusBanner() {
  const online = useIsOnline();
  const entries = useOutboxEntries();

  if (online) return null;

  const queued = entries.filter((e) => e.state !== "parked").length;
  const queueNote =
    queued > 0
      ? ` ${queued} change${queued === 1 ? "" : "s"} will sync when you're back.`
      : " Changes you make will sync when you're back.";

  return (
    <output className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-amber-950 text-sm">
      <span>
        You're offline — showing your local workspace.
        {queueNote}
      </span>
    </output>
  );
}
