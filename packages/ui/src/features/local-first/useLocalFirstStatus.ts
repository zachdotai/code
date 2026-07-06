import { OUTBOX } from "@posthog/core/local-store/outbox/identifiers";
import type { Outbox } from "@posthog/core/local-store/outbox/outbox";
import {
  type SyncStatusState,
  syncStatusStore,
} from "@posthog/core/local-store/sync/syncStatusStore";
import { useService } from "@posthog/di/react";
import type { OutboxEntry } from "@posthog/platform/local-persistence";
import { useEffect, useState } from "react";
import { useStore } from "zustand";

export function useIsOnline(): boolean {
  const [online, setOnline] = useState(
    () =>
      (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine ??
      true,
  );
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

/** Live outbox contents — updates on enqueue/flush/park. */
export function useOutboxEntries(): OutboxEntry[] {
  const outbox = useService<Outbox>(OUTBOX);
  const [entries, setEntries] = useState<OutboxEntry[]>(() => outbox.list());

  useEffect(() => {
    const refresh = () => setEntries(outbox.list());
    refresh();
    outbox.events.on("enqueued", refresh);
    outbox.events.on("flushed", refresh);
    outbox.events.on("parked", refresh);
    return () => {
      outbox.events.off("enqueued", refresh);
      outbox.events.off("flushed", refresh);
      outbox.events.off("parked", refresh);
    };
  }, [outbox]);

  return entries;
}

export function useSyncStatus(): SyncStatusState {
  return useStore(syncStatusStore);
}
