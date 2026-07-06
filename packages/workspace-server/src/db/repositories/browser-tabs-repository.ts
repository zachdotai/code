import type { TabsSnapshot } from "@posthog/shared";
import { asc, eq, inArray, isNull } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { DATABASE_SERVICE } from "../identifiers";
import { browserTabs, browserWindows } from "../schema";
import type { DatabaseService } from "../service";

/**
 * Durable storage for the Channels browser-tab strips, scoped per account
 * (`<cloudRegion>:<accountKey>`) so each login restores its own tabs. The
 * per-account snapshot is small (tens of rows), so each save is a
 * transactional full replace of that account's rows — simple and free of
 * delta-merge bugs. Window order is encoded by `position`; tabs inherit their
 * account scope through the window FK.
 */
export interface IBrowserTabsRepository {
  load(accountScope: string): TabsSnapshot;
  save(accountScope: string, snapshot: TabsSnapshot): void;
  /**
   * Adopt rows persisted before tabs were per-user (null scope) into the
   * given account, unless that account already has rows of its own. Keeps the
   * upgrade path seamless for the machine's existing user.
   */
  claimUnscoped(accountScope: string): void;
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

  private scopedWindowIds(accountScope: string) {
    return this.db
      .select({ id: browserWindows.id })
      .from(browserWindows)
      .where(eq(browserWindows.accountScope, accountScope));
  }

  load(accountScope: string): TabsSnapshot {
    const windowRows = this.db
      .select()
      .from(browserWindows)
      .where(eq(browserWindows.accountScope, accountScope))
      .orderBy(asc(browserWindows.position))
      .all();
    const tabRows = this.db
      .select()
      .from(browserTabs)
      .where(inArray(browserTabs.windowId, this.scopedWindowIds(accountScope)))
      .all();

    return {
      windows: windowRows.map((w) => ({
        id: w.id,
        isPrimary: w.isPrimary,
        bounds: w.bounds ?? null,
        activeTabId: w.activeTabId ?? null,
      })),
      tabs: tabRows.map((t) => ({
        id: t.id,
        windowId: t.windowId,
        dashboardId: t.dashboardId,
        taskId: t.taskId ?? null,
        channelId: t.channelId ?? null,
        channelSection: t.channelSection ?? null,
        position: t.position,
        scrollState: t.scrollState ?? null,
        createdAt: t.createdAt,
        lastActiveAt: t.lastActiveAt,
      })),
    };
  }

  save(accountScope: string, snapshot: TabsSnapshot): void {
    const now = Date.now();
    this.db.transaction((tx) => {
      // Tabs first (FK), then windows — only this account's rows.
      tx.delete(browserTabs)
        .where(
          inArray(browserTabs.windowId, this.scopedWindowIds(accountScope)),
        )
        .run();
      tx.delete(browserWindows)
        .where(eq(browserWindows.accountScope, accountScope))
        .run();

      if (snapshot.windows.length > 0) {
        tx.insert(browserWindows)
          .values(
            snapshot.windows.map((w, i) => ({
              id: w.id,
              accountScope,
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
              dashboardId: t.dashboardId,
              taskId: t.taskId ?? null,
              channelId: t.channelId ?? null,
              channelSection: t.channelSection ?? null,
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

  claimUnscoped(accountScope: string): void {
    this.db.transaction((tx) => {
      const owned = tx
        .select({ id: browserWindows.id })
        .from(browserWindows)
        .where(eq(browserWindows.accountScope, accountScope))
        .limit(1)
        .all();
      if (owned.length > 0) return;
      tx.update(browserWindows)
        .set({ accountScope, updatedAt: Date.now() })
        .where(isNull(browserWindows.accountScope))
        .run();
    });
  }
}
