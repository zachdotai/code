import type { TabsSnapshot } from "@posthog/shared";
import { isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { browserWindows } from "../schema";
import type { DatabaseService } from "../service";
import { createTestDb, type TestDatabase } from "../test-helpers";
import { BrowserTabsRepository } from "./browser-tabs-repository";

let testDb: TestDatabase;
let repo: BrowserTabsRepository;

beforeEach(() => {
  testDb = createTestDb();
  const databaseService = { db: testDb.db } as unknown as DatabaseService;
  repo = new BrowserTabsRepository(databaseService);
});

afterEach(() => {
  testDb.close();
});

const snapshot = (
  windowId: string,
  tabIds: string[],
  isPrimary = true,
): TabsSnapshot => ({
  windows: [{ id: windowId, isPrimary, bounds: null, activeTabId: null }],
  tabs: tabIds.map((id, i) => ({
    id,
    windowId,
    dashboardId: `dash-${id}`,
    taskId: null,
    channelId: null,
    channelSection: null,
    position: (i + 1) * 1000,
    scrollState: null,
    createdAt: 1,
    lastActiveAt: 1,
  })),
});

describe("BrowserTabsRepository", () => {
  it("round-trips a snapshot within one account scope", () => {
    const saved = snapshot("win-a", ["tab-1", "tab-2"]);
    repo.save("us:alice", saved);

    const loaded = repo.load("us:alice");
    expect(loaded.windows.map((w) => w.id)).toEqual(["win-a"]);
    expect(loaded.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-2"]);
  });

  it("keeps accounts isolated: saving one scope never touches another", () => {
    repo.save("us:alice", snapshot("win-a", ["tab-a"]));
    repo.save("us:bob", snapshot("win-b", ["tab-b"]));

    repo.save("us:alice", snapshot("win-a2", []));

    expect(repo.load("us:alice").windows.map((w) => w.id)).toEqual(["win-a2"]);
    expect(repo.load("us:bob").tabs.map((t) => t.id)).toEqual(["tab-b"]);
  });

  it("loads empty for a scope with no rows", () => {
    repo.save("us:alice", snapshot("win-a", ["tab-a"]));
    expect(repo.load("eu:alice")).toEqual({ windows: [], tabs: [] });
  });

  it("claimUnscoped adopts pre-account rows into the first account", () => {
    // Simulate rows written before per-user scoping existed.
    testDb.db
      .insert(browserWindows)
      .values({
        id: "legacy-win",
        isPrimary: true,
        position: 0,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();

    repo.claimUnscoped("us:alice");

    expect(repo.load("us:alice").windows.map((w) => w.id)).toEqual([
      "legacy-win",
    ]);
    const unscoped = testDb.db
      .select()
      .from(browserWindows)
      .where(isNull(browserWindows.accountScope))
      .all();
    expect(unscoped).toHaveLength(0);
  });

  it("claimUnscoped is a no-op when the account already has rows", () => {
    repo.save("us:alice", snapshot("win-a", []));
    testDb.db
      .insert(browserWindows)
      .values({
        id: "legacy-win",
        isPrimary: true,
        position: 0,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();

    repo.claimUnscoped("us:alice");

    expect(repo.load("us:alice").windows.map((w) => w.id)).toEqual(["win-a"]);
  });
});
