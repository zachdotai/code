import {
  type AccountScope,
  type BrowserWindow,
  closeTab,
  closeTabs,
  newBlankTab,
  openOrFocusTab,
  setTabOrder,
  setTabTarget,
  type TabsSnapshot,
  type TabTarget,
  TypedEventEmitter,
} from "@posthog/shared";
import { inject, injectable } from "inversify";
import { BROWSER_TABS_REPOSITORY } from "../../db/identifiers";
import type { IBrowserTabsRepository } from "../../db/repositories/browser-tabs-repository";
import { BrowserTabsEvent, type BrowserTabsEvents } from "./schemas";

const makeId = () => crypto.randomUUID();
const now = () => Date.now();

const sameScope = (
  a: AccountScope | null | undefined,
  b: AccountScope | null | undefined,
): boolean =>
  a === b ||
  (a != null &&
    b != null &&
    a.accountKey === b.accountKey &&
    a.cloudRegion === b.cloudRegion);

export interface IBrowserTabsService {
  getSnapshot(): TabsSnapshot;
  getPrimaryWindowId(): string;
  setAccountScope(scope: AccountScope | null): void;
  openOrFocus(
    input: TabTarget & {
      windowId: string;
      channelId: string | null;
      channelSection?: string | null;
    },
  ): TabsSnapshot;
  newBlankTab(input: { windowId: string }): TabsSnapshot;
  setTabTarget(
    input: TabTarget & {
      tabId: string;
      channelId: string | null;
      channelSection?: string | null;
    },
  ): TabsSnapshot;
  close(tabId: string): TabsSnapshot;
  closeMany(tabIds: string[], focusTabId?: string | null): TabsSnapshot;
  setOrder(input: { windowId: string; tabIds: string[] }): TabsSnapshot;
  setActiveTab(input: { windowId: string; tabId: string | null }): TabsSnapshot;
  snapshotChangeEvents(
    signal: AbortSignal | undefined,
  ): AsyncIterable<TabsSnapshot>;
}

/**
 * Authoritative, single-instance owner of the Channels browser-tab strips.
 * Lives in the shared main process so every renderer window reads and mutates
 * one source of truth; changes fan out to all windows via the snapshot-change
 * subscription. Durable state is persisted through the repository; the
 * back/forward action timeline is per-renderer and lives in the UI, not here.
 *
 * Tab strips are tied to the signed-in user: the host feeds auth changes in
 * via `setAccountScope`, and each scope change swaps the live snapshot to
 * that account's persisted tabs.
 *
 * The scope is three-state. `undefined` (initial) means the signed-in
 * identity is not known yet — app boot before auth resolves, a session still
 * restoring, or an identity fetch that hasn't succeeded. Tabs opened then are
 * held in memory and adopted into the account's snapshot once the scope
 * arrives, so nothing the user did while auth was catching up is lost.
 * `null` means confirmed signed out: tabs are memory-only by design, no
 * account's persisted tabs are read or overwritten, and nothing carries over
 * into the next login.
 */
@injectable()
export class BrowserTabsService
  extends TypedEventEmitter<BrowserTabsEvents>
  implements IBrowserTabsService
{
  private snapshot: TabsSnapshot;
  private accountScope: AccountScope | null | undefined = undefined;

  constructor(
    @inject(BROWSER_TABS_REPOSITORY)
    private readonly repo: IBrowserTabsRepository,
  ) {
    super();
    this.setMaxListeners(0);
    this.snapshot = this.ensurePrimaryWindow({ windows: [], tabs: [] });
  }

  /**
   * Point the service at an account's persisted tabs (null = signed out,
   * memory-only). Loads that account's snapshot — adopting any pre-account
   * rows on its first login, and re-homing tabs the user opened before the
   * scope was known — then fans the change out to every window.
   */
  setAccountScope(scope: AccountScope | null): void {
    if (sameScope(scope, this.accountScope)) return;
    const pending = this.accountScope === undefined ? this.snapshot : null;
    this.accountScope = scope;

    if (scope === null) {
      this.snapshot = this.ensurePrimaryWindow({ windows: [], tabs: [] });
      this.emit(BrowserTabsEvent.SnapshotChange, this.snapshot);
      return;
    }

    this.repo.claimUnscoped(scope);
    let next = this.ensurePrimaryWindow(this.repo.load(scope));
    if (pending) {
      const adopted = this.adoptPendingTabs(next, pending);
      if (adopted !== next) {
        next = adopted;
        this.repo.save(scope, next);
      }
    }
    this.snapshot = next;
    this.emit(BrowserTabsEvent.SnapshotChange, this.snapshot);
  }

  /**
   * Re-home tabs opened while the account scope was still undetermined into
   * the account's own snapshot, instead of discarding them with the swap.
   * Goes through {@link openOrFocusTab} so they dedupe against the account's
   * saved tabs; the pending strip's focused tab is opened last so it stays
   * focused. Blank tabs carry no content and are not worth carrying over.
   */
  private adoptPendingTabs(
    loaded: TabsSnapshot,
    pending: TabsSnapshot,
  ): TabsSnapshot {
    const targeted = pending.tabs
      .filter((t) => t.dashboardId || t.taskId || t.channelId)
      .sort((a, b) => a.position - b.position);
    if (targeted.length === 0) return loaded;

    const windowId = loaded.windows.find((w) => w.isPrimary)?.id;
    if (!windowId) return loaded;

    const activeTabId = pending.windows.find(
      (w) => w.activeTabId !== null,
    )?.activeTabId;
    const ordered = [
      ...targeted.filter((t) => t.id !== activeTabId),
      ...targeted.filter((t) => t.id === activeTabId),
    ];

    let next = loaded;
    for (const tab of ordered) {
      next = openOrFocusTab(next, {
        windowId,
        dashboardId: tab.dashboardId,
        taskId: tab.taskId,
        channelId: tab.channelId,
        channelSection: tab.channelSection,
        makeId,
        now,
      }).snapshot;
    }
    return next;
  }

  /** Guarantee a primary window exists so the first open has somewhere to land. */
  private ensurePrimaryWindow(snapshot: TabsSnapshot): TabsSnapshot {
    if (snapshot.windows.some((w) => w.isPrimary)) return snapshot;
    const primary: BrowserWindow = {
      id: makeId(),
      isPrimary: true,
      bounds: null,
      activeTabId: null,
    };
    return { ...snapshot, windows: [primary, ...snapshot.windows] };
  }

  getSnapshot(): TabsSnapshot {
    return this.snapshot;
  }

  /** Id of the primary window — the default target before multi-window. */
  getPrimaryWindowId(): string {
    const primary = this.snapshot.windows.find((w) => w.isPrimary);
    if (!primary) throw new Error("browser-tabs: no primary window");
    return primary.id;
  }

  openOrFocus(
    input: TabTarget & {
      windowId: string;
      channelId: string | null;
      channelSection?: string | null;
    },
  ): TabsSnapshot {
    const { snapshot } = openOrFocusTab(this.snapshot, {
      ...input,
      makeId,
      now,
    });
    return this.commit(snapshot);
  }

  newBlankTab(input: { windowId: string }): TabsSnapshot {
    const { snapshot } = newBlankTab(this.snapshot, {
      windowId: input.windowId,
      makeId,
      now,
    });
    return this.commit(snapshot);
  }

  setTabTarget(
    input: TabTarget & {
      tabId: string;
      channelId: string | null;
      channelSection?: string | null;
    },
  ): TabsSnapshot {
    return this.commit(setTabTarget(this.snapshot, { ...input, now }));
  }

  close(tabId: string): TabsSnapshot {
    const { snapshot } = closeTab(this.snapshot, tabId);
    return this.commit(snapshot);
  }

  closeMany(tabIds: string[], focusTabId?: string | null): TabsSnapshot {
    return this.commit(closeTabs(this.snapshot, tabIds, focusTabId));
  }

  setOrder(input: { windowId: string; tabIds: string[] }): TabsSnapshot {
    return this.commit(
      setTabOrder(this.snapshot, input.windowId, input.tabIds),
    );
  }

  setActiveTab(input: {
    windowId: string;
    tabId: string | null;
  }): TabsSnapshot {
    // Stale renderer state (e.g. router history stamped under a previous
    // account's snapshot) can reference a tab that no longer exists; writing
    // that id would leave the window's activeTabId dangling.
    if (
      input.tabId !== null &&
      !this.snapshot.tabs.some(
        (t) => t.id === input.tabId && t.windowId === input.windowId,
      )
    ) {
      return this.snapshot;
    }
    const next: TabsSnapshot = {
      ...this.snapshot,
      windows: this.snapshot.windows.map((w) =>
        w.id === input.windowId ? { ...w, activeTabId: input.tabId } : w,
      ),
    };
    return this.commit(next);
  }

  snapshotChangeEvents(
    signal: AbortSignal | undefined,
  ): AsyncIterable<TabsSnapshot> {
    return this.toIterable(BrowserTabsEvent.SnapshotChange, { signal });
  }

  private commit(next: TabsSnapshot): TabsSnapshot {
    this.snapshot = next;
    if (this.accountScope != null) this.repo.save(this.accountScope, next);
    this.emit(BrowserTabsEvent.SnapshotChange, next);
    return next;
  }
}
