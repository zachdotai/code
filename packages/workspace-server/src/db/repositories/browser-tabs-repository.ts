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
 *
 * The loaded snapshot is NOT guaranteed valid — an unparsable pane layout
 * comes back as a null-ish tree and dangling ids are passed through. The
 * service heals via `ensureSnapshotIntegrity` before first use.
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
    const paneRows = this.db.select().from(browserPanes).all();
    const tabRows = this.db.select().from(browserTabs).all();

    return {
      windows: windowRows.map((w) => {
        const layout = paneLayoutNodeSchema.safeParse(w.layout);
        return {
          id: w.id,
          isPrimary: w.isPrimary,
          bounds: w.bounds ?? null,
          // Unparsable/missing layout → healing rebuilds it from pane rows.
          layout: layout.success
            ? layout.data
            : (null as unknown as PaneLayoutNode),
          focusedPaneId: w.focusedPaneId ?? "",
        };
      }),
      panes: paneRows.map((p) => ({
        id: p.id,
        windowId: p.windowId,
        activeTabId: p.activeTabId ?? null,
        createdAt: p.createdAt,
      })),
      tabs: tabRows.map((t) => ({
        id: t.id,
        windowId: t.windowId,
        paneId: t.paneId ?? "",
        dashboardId: t.dashboardId,
        taskId: t.taskId ?? null,
        channelId: t.channelId ?? null,
        channelSection: t.channelSection ?? null,
        appView: t.appView ?? null,
        position: t.position,
        scrollState: t.scrollState ?? null,
        createdAt: t.createdAt,
        lastActiveAt: t.lastActiveAt,
      })),
    };
  }

  save(snapshot: TabsSnapshot): void {
    const now = Date.now();
    this.db.transaction((tx) => {
      // Children first (FK), then windows; inserts in the reverse order.
      tx.delete(browserTabs).run();
      tx.delete(browserPanes).run();
      tx.delete(browserWindows).run();

      if (snapshot.windows.length > 0) {
        tx.insert(browserWindows)
          .values(
            snapshot.windows.map((w, i) => ({
              id: w.id,
              isPrimary: w.isPrimary,
              bounds: w.bounds ?? null,
              layout: w.layout,
              focusedPaneId: w.focusedPaneId,
              position: i,
              createdAt: now,
              updatedAt: now,
            })),
          )
          .run();
      }
      if (snapshot.panes.length > 0) {
        tx.insert(browserPanes)
          .values(
            snapshot.panes.map((p) => ({
              id: p.id,
              windowId: p.windowId,
              activeTabId: p.activeTabId ?? null,
              createdAt: p.createdAt,
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
              paneId: t.paneId,
              dashboardId: t.dashboardId,
              taskId: t.taskId ?? null,
              channelId: t.channelId ?? null,
              channelSection: t.channelSection ?? null,
              appView: t.appView ?? null,
              position: t.position,
              scrollState: t.scrollState ?? null,
              createdAt: t.createdAt,
              lastActiveAt: t.lastActiveAt,
            })),
          )
          .run();
      }
    });
  }
}
