import {
  closePane,
  closeTab,
  closeTabs,
  ensureSnapshotIntegrity,
  mergeTabIntoTab,
  newBlankTab,
  openOrFocusTab,
  type SplitDropDirection,
  setFocusedPane,
  setPaneSizes,
  setPaneTarget,
  setTabOrder,
  setWindowActiveTab,
  type TabsSnapshot,
  TypedEventEmitter,
} from "@posthog/shared";
import { inject, injectable } from "inversify";
import { BROWSER_TABS_REPOSITORY } from "../../db/identifiers";
import type { IBrowserTabsRepository } from "../../db/repositories/browser-tabs-repository";
import { BrowserTabsEvent, type BrowserTabsEvents } from "./schemas";

const makeId = () => crypto.randomUUID();
const now = () => Date.now();

/** Identity fields a pane can point at, as the tRPC inputs deliver them. */
type PaneIdentityInput = {
  dashboardId: string | null;
  taskId: string | null;
  channelId: string | null;
  channelSection: string | null;
  appView: string | null;
};

export interface IBrowserTabsService {
  getSnapshot(): TabsSnapshot;
  getPrimaryWindowId(): string;
  openOrFocus(
    input: PaneIdentityInput & {
      windowId: string;
      tabId?: string;
      paneId?: string;
    },
  ): TabsSnapshot;
  newBlankTab(input: {
    windowId: string;
    tabId?: string;
    paneId?: string;
  }): TabsSnapshot;
  setPaneTarget(input: PaneIdentityInput & { paneId: string }): TabsSnapshot;
  close(input: {
    tabId: string;
    blankTabId?: string;
    blankPaneId?: string;
  }): TabsSnapshot;
  closeMany(tabIds: string[], focusTabId?: string | null): TabsSnapshot;
  closePane(input: { tabId: string; paneId: string }): TabsSnapshot;
  mergeTabIntoTab(input: {
    windowId: string;
    sourceTabId: string;
    targetTabId: string;
    targetPaneId: string | null;
    direction: SplitDropDirection;
  }): TabsSnapshot;
  setOrder(input: { windowId: string; tabIds: string[] }): TabsSnapshot;
  setActiveTab(input: { windowId: string; tabId: string | null }): TabsSnapshot;
  setFocusedPane(input: { tabId: string; paneId: string }): TabsSnapshot;
  setPaneSizes(input: {
    tabId: string;
    path: number[];
    sizes: number[];
  }): TabsSnapshot;
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
 */
@injectable()
export class BrowserTabsService
  extends TypedEventEmitter<BrowserTabsEvents>
  implements IBrowserTabsService
{
  private snapshot: TabsSnapshot;

  constructor(
    @inject(BROWSER_TABS_REPOSITORY)
    private readonly repo: IBrowserTabsRepository,
  ) {
    super();
    this.setMaxListeners(0);
    const loaded = this.repo.load();
    // Heal every boot-time invariant in one pass (primary window exists,
    // >= 1 tab, layout↔pane bijection, valid focus). Re-persist only when
    // something actually changed (reference inequality).
    const healed = ensureSnapshotIntegrity(loaded, { makeId, now });
    if (healed !== loaded) this.repo.save(healed);
    this.snapshot = healed;
  }

  /** Creation targets heal a stale window id (a mirror seeded before a schema
   * repair, or another window's since-closed id) to the primary window rather
   * than appending into a window that doesn't exist. Deliberately creation-only:
   * a desynced mirror's reorder (`setOrder`) or focus (`setActiveTab`) carries
   * stale TAB ids too, so retargeting those at the primary window would apply
   * wrong state — the shared transforms no-op safely instead, and the snapshot
   * reconcile heals the mirror. Creating a tab is window-independent intent. */
  private resolveWindowId(windowId: string): string {
    return this.snapshot.windows.some((w) => w.id === windowId)
      ? windowId
      : this.getPrimaryWindowId();
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
    input: PaneIdentityInput & {
      windowId: string;
      tabId?: string;
      paneId?: string;
    },
  ): TabsSnapshot {
    // Renderer-minted ids ride through so the caller's optimistic apply and
    // this persisted state agree. Dedup-by-identity still applies first, so a
    // replay of the same open focuses the existing tab.
    const { snapshot } = openOrFocusTab(this.snapshot, {
      ...input,
      windowId: this.resolveWindowId(input.windowId),
      makeId,
      now,
    });
    return this.commit(snapshot);
  }

  newBlankTab(input: {
    windowId: string;
    tabId?: string;
    paneId?: string;
  }): TabsSnapshot {
    // Idempotent on the renderer-minted id: a replay of the same call (blank
    // tabs have no identity to dedup on) must not append a second tab.
    if (input.tabId && this.snapshot.tabs.some((t) => t.id === input.tabId)) {
      return this.snapshot;
    }
    const { snapshot } = newBlankTab(this.snapshot, {
      windowId: this.resolveWindowId(input.windowId),
      tabId: input.tabId,
      paneId: input.paneId,
      makeId,
      now,
    });
    return this.commit(snapshot);
  }

  setPaneTarget(input: PaneIdentityInput & { paneId: string }): TabsSnapshot {
    return this.commit(setPaneTarget(this.snapshot, { ...input, now }));
  }

  close(input: {
    tabId: string;
    blankTabId?: string;
    blankPaneId?: string;
  }): TabsSnapshot {
    const { snapshot } = closeTab(this.snapshot, input.tabId, {
      makeId,
      now,
      blankTabId: input.blankTabId,
      blankPaneId: input.blankPaneId,
    });
    return this.commit(snapshot);
  }

  closeMany(tabIds: string[], focusTabId?: string | null): TabsSnapshot {
    return this.commit(
      closeTabs(this.snapshot, tabIds, focusTabId, { makeId, now }),
    );
  }

  closePane(input: { tabId: string; paneId: string }): TabsSnapshot {
    return this.commit(closePane(this.snapshot, input.tabId, input.paneId));
  }

  mergeTabIntoTab(input: {
    windowId: string;
    sourceTabId: string;
    targetTabId: string;
    targetPaneId: string | null;
    direction: SplitDropDirection;
  }): TabsSnapshot {
    return this.commit(mergeTabIntoTab(this.snapshot, { ...input, now }));
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
    // Validated: a tabId that doesn't exist in the window (a stale mirror
    // replayed after the tab closed) is ignored rather than persisted as a
    // dangling activeTabId — that dangle makes every later navigation look like
    // "no active tab" and silently open new tabs.
    const next = setWindowActiveTab(this.snapshot, input.windowId, input.tabId);
    if (next === this.snapshot) return this.snapshot;
    return this.commit(next);
  }

  setFocusedPane(input: { tabId: string; paneId: string }): TabsSnapshot {
    const next = setFocusedPane(this.snapshot, input.tabId, input.paneId);
    if (next === this.snapshot) return this.snapshot;
    return this.commit(next);
  }

  setPaneSizes(input: {
    tabId: string;
    path: number[];
    sizes: number[];
  }): TabsSnapshot {
    const next = setPaneSizes(
      this.snapshot,
      input.tabId,
      input.path,
      input.sizes,
    );
    if (next === this.snapshot) return this.snapshot;
    return this.commit(next);
  }

  snapshotChangeEvents(
    signal: AbortSignal | undefined,
  ): AsyncIterable<TabsSnapshot> {
    return this.toIterable(BrowserTabsEvent.SnapshotChange, { signal });
  }

  private commit(next: TabsSnapshot): TabsSnapshot {
    this.snapshot = next;
    this.repo.save(next);
    this.emit(BrowserTabsEvent.SnapshotChange, next);
    return next;
  }
}
