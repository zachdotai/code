import {
  closePane,
  closeTab,
  closeTabs,
  ensureSnapshotIntegrity,
  moveTabToPane,
  newBlankTab,
  openOrFocusTab,
  type SplitDropDirection,
  setFocusedPane,
  setPaneActiveTab,
  setPaneSizes,
  setTabOrder,
  setTabTarget,
  splitPane,
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
  openOrFocus(
    input: TabTarget & {
      paneId: string;
      channelId: string | null;
      channelSection?: string | null;
      appView?: string | null;
      tabId?: string;
    },
  ): TabsSnapshot;
  newBlankTab(input: { paneId: string; tabId?: string }): TabsSnapshot;
  setTabTarget(
    input: TabTarget & {
      tabId: string;
      channelId: string | null;
      channelSection?: string | null;
      appView?: string | null;
    },
  ): TabsSnapshot;
  close(tabId: string, blankTabId?: string): TabsSnapshot;
  closeMany(
    tabIds: string[],
    focusTabId?: string | null,
    blankTabId?: string,
  ): TabsSnapshot;
  setOrder(input: { paneId: string; tabIds: string[] }): TabsSnapshot;
  setActiveTab(input: { paneId: string; tabId: string }): TabsSnapshot;
  splitPane(input: {
    windowId: string;
    targetPaneId: string | null;
    direction: SplitDropDirection;
    tabId: string;
    paneId?: string;
  }): TabsSnapshot;
  moveTabToPane(input: {
    tabId: string;
    toPaneId: string;
    index?: number;
  }): TabsSnapshot;
  closePane(input: {
    windowId: string;
    paneId: string;
    blankTabId?: string;
  }): TabsSnapshot;
  setFocusedPane(input: { windowId: string; paneId: string }): TabsSnapshot;
  setPaneSizes(input: {
    windowId: string;
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
    // Healing covers both migrated data (0020 only does structural copies)
    // and any future corruption: primary window, layout<->pane bijection,
    // dangling ids, empty panes.
    const loaded = this.repo.load();
    const healed = ensureSnapshotIntegrity(loaded, { makeId, now });
    if (healed !== loaded) this.repo.save(healed);
    this.snapshot = healed;
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
      paneId: string;
      channelId: string | null;
      channelSection?: string | null;
      appView?: string | null;
      tabId?: string;
    },
  ): TabsSnapshot {
    // Honor a renderer-minted id so the caller's optimistic apply and this
    // persisted state agree on the id. Dedup-by-identity still applies first,
    // so a replay of the same open focuses the existing tab.
    const providedId = input.tabId;
    const { snapshot } = openOrFocusTab(this.snapshot, {
      ...input,
      makeId: providedId ? () => providedId : makeId,
      now,
    });
    return this.commit(snapshot);
  }

  newBlankTab(input: { paneId: string; tabId?: string }): TabsSnapshot {
    const providedId = input.tabId;
    // Idempotent on the renderer-minted id: a replay of the same call (blank
    // tabs have no identity to dedup on) must not append a second tab.
    if (providedId && this.snapshot.tabs.some((t) => t.id === providedId)) {
      return this.snapshot;
    }
    const { snapshot } = newBlankTab(this.snapshot, {
      paneId: input.paneId,
      makeId: providedId ? () => providedId : makeId,
      now,
    });
    return this.commit(snapshot);
  }

  setTabTarget(
    input: TabTarget & {
      tabId: string;
      channelId: string | null;
      channelSection?: string | null;
      appView?: string | null;
    },
  ): TabsSnapshot {
    return this.commit(setTabTarget(this.snapshot, { ...input, now }));
  }

  close(tabId: string, blankTabId?: string): TabsSnapshot {
    // The blank-backfill id is renderer-minted and single-use: if it already
    // exists this is a replay whose close already happened — commit no-op.
    if (blankTabId && this.snapshot.tabs.some((t) => t.id === blankTabId)) {
      return this.snapshot;
    }
    const { snapshot } = closeTab(this.snapshot, tabId, {
      makeId,
      now,
      blankTabId,
    });
    return this.commit(snapshot);
  }

  closeMany(
    tabIds: string[],
    focusTabId?: string | null,
    blankTabId?: string,
  ): TabsSnapshot {
    if (blankTabId && this.snapshot.tabs.some((t) => t.id === blankTabId)) {
      return this.snapshot;
    }
    return this.commit(
      closeTabs(this.snapshot, tabIds, { makeId, now, blankTabId }, focusTabId),
    );
  }

  setOrder(input: { paneId: string; tabIds: string[] }): TabsSnapshot {
    return this.commit(setTabOrder(this.snapshot, input.paneId, input.tabIds));
  }

  setActiveTab(input: { paneId: string; tabId: string }): TabsSnapshot {
    // Validated: a tabId that doesn't exist in the pane (a stale history tag
    // replayed after the tab closed) is ignored rather than persisted as a
    // dangling activeTabId — that dangle makes every later navigation look like
    // "no active tab" and silently open new tabs.
    const next = setPaneActiveTab(this.snapshot, input.paneId, input.tabId);
    if (next === this.snapshot) return this.snapshot;
    return this.commit(next);
  }

  splitPane(input: {
    windowId: string;
    targetPaneId: string | null;
    direction: SplitDropDirection;
    tabId: string;
    paneId?: string;
  }): TabsSnapshot {
    // The shared transform is itself idempotent on an existing paneId, so a
    // replay of the same split commits a no-op.
    const { snapshot } = splitPane(this.snapshot, {
      windowId: input.windowId,
      targetPaneId: input.targetPaneId,
      direction: input.direction,
      tabId: input.tabId,
      newPaneId: input.paneId ?? makeId(),
      now,
    });
    if (snapshot === this.snapshot) return this.snapshot;
    return this.commit(snapshot);
  }

  moveTabToPane(input: {
    tabId: string;
    toPaneId: string;
    index?: number;
  }): TabsSnapshot {
    const next = moveTabToPane(this.snapshot, { ...input, now });
    if (next === this.snapshot) return this.snapshot;
    return this.commit(next);
  }

  closePane(input: {
    windowId: string;
    paneId: string;
    blankTabId?: string;
  }): TabsSnapshot {
    if (
      input.blankTabId &&
      this.snapshot.tabs.some((t) => t.id === input.blankTabId)
    ) {
      return this.snapshot;
    }
    const { snapshot } = closePane(this.snapshot, {
      windowId: input.windowId,
      paneId: input.paneId,
      makeId,
      now,
      blankTabId: input.blankTabId,
    });
    if (snapshot === this.snapshot) return this.snapshot;
    return this.commit(snapshot);
  }

  setFocusedPane(input: { windowId: string; paneId: string }): TabsSnapshot {
    const next = setFocusedPane(this.snapshot, input.windowId, input.paneId);
    if (next === this.snapshot) return this.snapshot;
    return this.commit(next);
  }

  setPaneSizes(input: {
    windowId: string;
    path: number[];
    sizes: number[];
  }): TabsSnapshot {
    const next = setPaneSizes(
      this.snapshot,
      input.windowId,
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
