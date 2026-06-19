const PR_URL_REGEX = /https:\/\/github\.com\/[^/\s"]+\/[^/\s"]+\/pull\/\d+/;

// A fixed window (not "since run start") so a PR the agent merely views on a
// long run is too old to be mistaken for one it just created.
//
// Sized to comfortably cover a real run rather than a single tool call: a PR is
// often created in an early turn and only surfaces again (a summary line, a
// follow-up turn, a coalesced/late terminal flush) much later in the same
// multi-turn run. The old 15-minute window failed closed on exactly those runs,
// so the PR was never attributed and the Slack inbox notification — which is
// gated on attribution — silently never fired. A day is wide enough for any
// realistic run while still excluding genuinely stale PRs the agent only views.
export const PR_CREATION_RECENCY_MS = 24 * 60 * 60 * 1000;

export function findPrUrl(text: string): string | null {
  return text.match(PR_URL_REGEX)?.[0] ?? null;
}

// Fails closed on missing/invalid input so we never attribute on uncertainty.
export function wasCreatedRecently(
  createdAtIso: string | null | undefined,
  nowMs: number,
  maxAgeMs: number = PR_CREATION_RECENCY_MS,
): boolean {
  if (!createdAtIso) return false;
  const createdAt = new Date(createdAtIso);
  if (Number.isNaN(createdAt.getTime())) return false;
  return createdAt.getTime() >= nowMs - maxAgeMs;
}
