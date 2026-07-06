/**
 * Cross-window/tab leader election. Exactly one context (the leader) runs the
 * sync engine's loops and owns local-persistence writes; followers apply
 * broadcast deltas to their in-memory pools only. Browser hosts implement this
 * over `navigator.locks` (lock release on window death IS the failover signal).
 */
export interface LeaderElection {
  /**
   * Campaign for the named leadership. `onLeadership` is invoked when (and
   * each time) this context acquires the lock; its AbortSignal fires when
   * leadership is lost or surrendered. The returned dispose function
   * withdraws from the campaign and releases leadership if held.
   */
  campaign(
    name: string,
    onLeadership: (signal: AbortSignal) => void,
  ): () => void;
}

export const LEADER_ELECTION = Symbol.for("posthog.platform.leaderElection");
