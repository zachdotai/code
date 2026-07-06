import {
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

export interface IBrowserTabsService {
  getSnapshot(): TabsSnapshot;
  getPrimaryWindowId(): string;
  setAccountScope(accountScope: string | null): void;
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
 * that account's persisted tabs. With no scope (signed out) tabs are
 * memory-only, so no account's persisted tabs are read or overwritten.
 */
@injectable()
export class BrowserTabsService
  extends TypedEventEmitter<BrowserTabsEvents>
  implements IBrowserTabsService
{
  private snapshot: TabsSnapshot;
  private accountScope: string | null = null;

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
   * rows on its first login — and fans the change out to every window.
   */
  setAccountScope(accountScope: string | null): void {
    if (accountScope === this.accountScope) return;
    this.accountScope = accountScope;

    if (accountScope === null) {
      this.snapshot = this.ensurePrimaryWindow({ windows: [], tabs: [] });
      this.emit(BrowserTabsEvent.SnapshotChange, this.snapshot);
      return;
    }

    this.repo.claimUnscoped(accountScope);
    const loaded = this.repo.load(accountScope);
    const seeded = this.ensurePrimaryWindow(loaded);
    if (seeded !== loaded) this.repo.save(accountScope, seeded);
    this.snapshot = seeded;
    this.emit(BrowserTabsEvent.SnapshotChange, this.snapshot);
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
    if (this.accountScope !== null) this.repo.save(this.accountScope, next);
    this.emit(BrowserTabsEvent.SnapshotChange, next);
    return next;
  }
}
