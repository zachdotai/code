import type { AccountScope, TabsSnapshot } from "@posthog/shared";
import type { IBrowserTabsRepository } from "./browser-tabs-repository";

const scopeKey = (scope: AccountScope) =>
  `${scope.cloudRegion}:${scope.accountKey}`;

export interface MockBrowserTabsRepository extends IBrowserTabsRepository {
  /** Persisted snapshots keyed by `<cloudRegion>:<accountKey>`. */
  _snapshots: Map<string, TabsSnapshot>;
  /** Scopes claimUnscoped was called with, in order. */
  _claimed: AccountScope[];
}

export function createMockBrowserTabsRepository(): MockBrowserTabsRepository {
  const snapshots = new Map<string, TabsSnapshot>();
  const claimed: AccountScope[] = [];

  return {
    _snapshots: snapshots,
    _claimed: claimed,
    load: (scope) =>
      snapshots.get(scopeKey(scope)) ?? { windows: [], tabs: [] },
    save: (scope, snapshot) => {
      snapshots.set(scopeKey(scope), snapshot);
    },
    claimUnscoped: (scope) => {
      claimed.push(scope);
    },
  };
}
