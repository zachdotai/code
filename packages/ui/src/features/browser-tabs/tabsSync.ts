import { browserTabsStore } from "@posthog/core/browser-tabs/browserTabsStore";
import type { TabsSnapshot } from "@posthog/shared";

/**
 * Local-first sync policy for the browser-tabs mirror.
 *
 * Every tab operation applies its shared pure transform to the renderer mirror
 * synchronously (the UI renders from the mirror, so interactions are instant),
 * then persists to the main process in the background. Because the renderer
 * and the service run the SAME transforms in the SAME order, the mirror and
 * the durable snapshot converge — the server round-trip carries no new
 * information for this window.
 *
 * The hazard this module exists to prevent: the main process echoes every
 * commit back (the mutation's return value and the snapshotChange fan-out).
 * Under rapid input, the echo of write N arrives AFTER the local apply of
 * write N+1; applying it would rewind the mirror, and the navigation effect
 * would re-decide against stale state and misfire persistent writes (the
 * historical "tab targets swap / titles flicker" corruption). So while any
 * local write is in flight, remote snapshots are dropped; when the LAST
 * in-flight write settles, its returned snapshot — which reflects every write
 * up to and including it — is applied once as the authoritative reconcile
 * (normally value-equal to the mirror, so the store's equality guard makes it
 * a no-op).
 */
let inFlight = 0;

// Authoritative-snapshot fetcher, registered once at boot by the events
// contribution (tabsSync can't reach the injected BrowserTabsClient itself).
// Used only to reconcile after a FAILED write — see persistWrite's catch.
let fetchAuthoritative: (() => Promise<TabsSnapshot>) | null = null;

export function registerSnapshotFetcher(
  fetch: (() => Promise<TabsSnapshot>) | null,
): void {
  fetchAuthoritative = fetch;
}

/** Read the mirror's current snapshot (non-reactive; for event handlers and
 * effects that must see the latest state without subscribing to it). */
export function readMirror(): TabsSnapshot {
  return browserTabsStore.getState().snapshot;
}

/** Synchronously apply a pure transform to the mirror (the optimistic write). */
export function applyLocalTransform(
  transform: (snapshot: TabsSnapshot) => TabsSnapshot,
): TabsSnapshot {
  const store = browserTabsStore.getState();
  const next = transform(store.snapshot);
  store.setSnapshot(next);
  return next;
}

/**
 * Persist a local write to the main process. Fire-and-forget from the caller's
 * perspective: the UI has already moved via applyLocalTransform. Only the last
 * settling write applies its server snapshot (see module doc). A failed write
 * is swallowed — the next successful write's settle (or the next remote
 * snapshot once idle) reconciles the mirror with the durable state.
 */
export async function persistWrite(
  write: () => Promise<TabsSnapshot>,
): Promise<void> {
  inFlight++;
  try {
    const server = await write();
    // Last-settling write applies its snapshot. Over Electron IPC this is also
    // the last-ISSUED write (single FIFO channel, synchronous service handlers,
    // so responses return in request order); if this ever migrates to a
    // transport that can reorder responses (HTTP batching, WS), "last to
    // settle" stops implying "newest snapshot" and this needs a sequence guard.
    if (inFlight === 1) {
      browserTabsStore.getState().setSnapshot(server);
    }
  } catch {
    // Failed write: the optimistic mirror may hold state the server never
    // committed, and a failed mutation emits no snapshotChange push — so if
    // this was the last write in flight, nothing else would reconcile (any
    // earlier overlapping writes skipped their settle apply). Re-pull the
    // authoritative snapshot; apply only if still idle when it arrives (a
    // newer write's settle otherwise supersedes it).
    if (inFlight === 1) {
      void fetchAuthoritative?.()
        .then((server) => {
          if (inFlight === 0) {
            browserTabsStore.getState().setSnapshot(server);
          }
        })
        .catch(() => undefined);
    }
  } finally {
    inFlight--;
  }
}

/**
 * Apply a snapshot pushed from the main process (boot seed, or a mutation made
 * by another window). Dropped while local writes are in flight — those pushes
 * are echoes of our own writes and may predate newer local state.
 */
export function applyRemoteSnapshot(snapshot: TabsSnapshot): void {
  if (inFlight > 0) return;
  browserTabsStore.getState().setSnapshot(snapshot);
}

// Dev-only inspection handle so the live mirror can be dumped from the console
// (and by agent-browser during dogfooding). No-op in production builds.
if (import.meta.env.DEV) {
  (globalThis as { __tabsMirror?: () => TabsSnapshot }).__tabsMirror = () =>
    browserTabsStore.getState().snapshot;
}
