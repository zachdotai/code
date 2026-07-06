import type { LeaderElection } from "@posthog/platform/leader-election";

/**
 * Leader election over the Web Locks API. `navigator.locks.request` queues
 * until the named lock is free; the winner holds it until its callback promise
 * settles or the context dies — lock release on window death is the failover
 * signal, so no heartbeats are needed.
 */
export class WebLocksLeaderElection implements LeaderElection {
  campaign(
    name: string,
    onLeadership: (signal: AbortSignal) => void,
  ): () => void {
    // Aborts the *pending* lock request when the campaign is withdrawn before
    // leadership was ever acquired.
    const requestController = new AbortController();
    let leadershipController: AbortController | null = null;
    let releaseHeldLock: (() => void) | null = null;
    let disposed = false;

    navigator.locks
      .request(name, { signal: requestController.signal }, async () => {
        if (disposed) return;
        leadershipController = new AbortController();
        onLeadership(leadershipController.signal);
        // Hold the lock until the campaign is disposed. If this context dies,
        // the browser releases the lock and the next campaigner wins.
        await new Promise<void>((resolve) => {
          releaseHeldLock = resolve;
        });
      })
      .catch(() => {
        // AbortError from withdrawing a pending request — expected on dispose.
      });

    return () => {
      disposed = true;
      leadershipController?.abort();
      releaseHeldLock?.();
      requestController.abort();
    };
  }
}
