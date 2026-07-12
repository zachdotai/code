import {
  type PaneLayoutNode,
  paneLayoutNodeSchema,
  type TabsSnapshot,
} from "@posthog/shared";
import { asc } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { DATABASE_SERVICE } from "../identifiers";
import { browserPanes, browserTabs, browserWindows } from "../schema";
import type { DatabaseService } from "../service";

/**
 * Durable storage for the Channels browser-tab strips. The whole snapshot is
 * small (tens of rows), so each save is a transactional full replace — simple
 * and free of delta-merge bugs. Window order is encoded by `position`.
 */
export interface IBrowserTabsRepository {
  load(): TabsSnapshot;
  save(snapshot: TabsSnapshot): void;
}

@injectable()
export class BrowserTabsRepository implements IBrowserTabsRepository {
  constructor(
    @inject(DATABASE_SERVICE)
    private readonly databaseService: DatabaseService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  load(): TabsSnapshot {
    const windowRows = this.db
      .select()
      .from(browserWindows)
      .orderBy(asc(browserWindows.position))
      .all();
    const tabRows = this.db.select().from(browserTabs).all();
    const paneRows = this.db.select().from(browserPanes).all();

    return {
      windows: windowRows.map((w) => ({
        id: w.id,
        isPrimary: w.isPrimary,
        bounds: w.bounds ?? null,
        activeTabId: w.activeTabId ?? null,
      })),
      tabs: tabRows.map((t) => {
        // A corrupt/null layout (the column is nullable at the SQL level)
        // degrades to a leaf of the focused pane; ensureSnapshotIntegrity in
        // the service reconciles the leaf↔pane bijection from there.
        const parsed = paneLayoutNodeSchema.safeParse(t.layout);
        const focusedPaneId = t.focusedPaneId ?? `${t.id}-pane`;
        const layout: PaneLayoutNode = parsed.success
          ? parsed.data
          : { type: "leaf", paneId: focusedPaneId };
        return {
          id: t.id,
          windowId: t.windowId,
          layout,
          focusedPaneId,
          position: t.position,
          createdAt: t.createdAt,
          lastActiveAt: t.lastActiveAt,
        };
      }),
      panes: paneRows.map((p) => ({
        id: p.id,
        tabId: p.tabId,
        windowId: p.windowId,
        dashboardId: p.dashboardId,
        taskId: p.taskId ?? null,
        channelId: p.channelId ?? null,
        channelSection: p.channelSection ?? null,
        appView: p.appView ?? null,
        scrollState: p.scrollState ?? null,
        createdAt: p.createdAt,
        lastActiveAt: p.lastActiveAt,
      })),
    };
  }

  save(snapshot: TabsSnapshot): void {
    const now = Date.now();
    this.db.transaction((tx) => {
      // Children first (FK): panes, then tabs, then windows.
      tx.delete(browserPanes).run();
      tx.delete(browserTabs).run();
      tx.delete(browserWindows).run();

      if (snapshot.windows.length > 0) {
        tx.insert(browserWindows)
          .values(
            snapshot.windows.map((w, i) => ({
              id: w.id,
              isPrimary: w.isPrimary,
              bounds: w.bounds ?? null,
              activeTabId: w.activeTabId ?? null,
              position: i,
              createdAt: now,
              updatedAt: now,
            })),
          )
          .run();
      }
      if (snapshot.tabs.length > 0) {
        tx.insert(browserTabs)
          .values(
            snapshot.tabs.map((t) => ({
              id: t.id,
              windowId: t.windowId,
              layout: t.layout,
              focusedPaneId: t.focusedPaneId,
              position: t.position,
              createdAt: t.createdAt,
              lastActiveAt: t.lastActiveAt,
            })),
          )
          .run();
      }
      if (snapshot.panes.length > 0) {
        tx.insert(browserPanes)
          .values(
            snapshot.panes.map((p) => ({
              id: p.id,
              tabId: p.tabId,
              windowId: p.windowId,
              dashboardId: p.dashboardId,
              taskId: p.taskId ?? null,
              channelId: p.channelId ?? null,
              channelSection: p.channelSection ?? null,
              appView: p.appView ?? null,
              scrollState: p.scrollState ?? null,
              createdAt: p.createdAt,
              lastActiveAt: p.lastActiveAt,
            })),
          )
          .run();
      }
    });
  }
}
