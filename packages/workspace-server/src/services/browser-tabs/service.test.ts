import type { AccountScope, TabsSnapshot } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import { createMockBrowserTabsRepository } from "../../db/repositories/browser-tabs-repository.mock";
import { BrowserTabsEvent } from "./schemas";
import { BrowserTabsService } from "./service";

const alice: AccountScope = { accountKey: "alice", cloudRegion: "us" };
const bob: AccountScope = { accountKey: "bob", cloudRegion: "us" };
const key = (scope: AccountScope) => `${scope.cloudRegion}:${scope.accountKey}`;

const makeService = () => {
  const repo = createMockBrowserTabsRepository();
  const service = new BrowserTabsService(repo);
  return { repo, service };
};

const openCanvasTab = (service: BrowserTabsService, dashboardId: string) =>
  service.openOrFocus({
    windowId: service.getPrimaryWindowId(),
    dashboardId,
    taskId: null,
    channelId: null,
  });

const savedSnapshot = (
  windowId: string,
  tabs: { id: string; dashboardId: string }[],
  activeTabId: string | null = null,
): TabsSnapshot => ({
  windows: [{ id: windowId, isPrimary: true, bounds: null, activeTabId }],
  tabs: tabs.map((t, i) => ({
    id: t.id,
    windowId,
    dashboardId: t.dashboardId,
    taskId: null,
    channelId: null,
    channelSection: null,
    position: (i + 1) * 1000,
    scrollState: null,
    createdAt: 1,
    lastActiveAt: 1,
  })),
});

describe("BrowserTabsService account scoping", () => {
  it("starts with an undetermined scope and a memory-only primary window", () => {
    const { repo, service } = makeService();
    expect(service.getPrimaryWindowId()).toBeTruthy();
    service.newBlankTab({ windowId: service.getPrimaryWindowId() });
    expect(repo._snapshots.size).toBe(0);
  });

  it("persists mutations under the signed-in account's scope", () => {
    const { repo, service } = makeService();
    service.setAccountScope(alice);
    service.newBlankTab({ windowId: service.getPrimaryWindowId() });
    expect(repo._snapshots.get(key(alice))?.tabs).toHaveLength(1);
  });

  it("restores each account's tabs when switching users", () => {
    const { service } = makeService();

    service.setAccountScope(alice);
    openCanvasTab(service, "dash-a");
    const aliceTabs = service.getSnapshot().tabs.map((t) => t.id);
    expect(aliceTabs).toHaveLength(1);

    // Logout then login as bob: blank strip, none of alice's tabs.
    service.setAccountScope(null);
    expect(service.getSnapshot().tabs).toHaveLength(0);
    service.setAccountScope(bob);
    expect(service.getSnapshot().tabs).toHaveLength(0);
    openCanvasTab(service, "dash-b1");
    openCanvasTab(service, "dash-b2");

    // Back to alice: her single tab comes back.
    service.setAccountScope(null);
    service.setAccountScope(alice);
    expect(service.getSnapshot().tabs.map((t) => t.id)).toEqual(aliceTabs);
  });

  it("adopts tabs opened before the first scope is known into the account's snapshot", () => {
    const { repo, service } = makeService();
    repo._snapshots.set(
      key(alice),
      savedSnapshot(
        "win-a",
        [{ id: "tab-saved", dashboardId: "dash-saved" }],
        "tab-saved",
      ),
    );

    // Opened during app boot, before auth resolved.
    openCanvasTab(service, "dash-boot");

    service.setAccountScope(alice);

    const snapshot = service.getSnapshot();
    expect(snapshot.tabs.map((t) => t.dashboardId).sort()).toEqual([
      "dash-boot",
      "dash-saved",
    ]);
    // The tab the user just opened stays focused, and the merge is persisted.
    const adopted = snapshot.tabs.find((t) => t.dashboardId === "dash-boot");
    expect(snapshot.windows[0]?.activeTabId).toBe(adopted?.id);
    expect(repo._snapshots.get(key(alice))).toEqual(snapshot);
  });

  it("dedupes adopted tabs against the account's saved tabs", () => {
    const { repo, service } = makeService();
    repo._snapshots.set(
      key(alice),
      savedSnapshot("win-a", [{ id: "tab-saved", dashboardId: "dash-x" }]),
    );

    openCanvasTab(service, "dash-x");
    service.setAccountScope(alice);

    const snapshot = service.getSnapshot();
    expect(snapshot.tabs).toHaveLength(1);
    expect(snapshot.tabs[0]?.id).toBe("tab-saved");
    expect(snapshot.windows[0]?.activeTabId).toBe("tab-saved");
  });

  it("does not adopt tabs opened while signed out", () => {
    const { service } = makeService();
    service.setAccountScope(null);
    openCanvasTab(service, "dash-anon");

    service.setAccountScope(alice);
    expect(service.getSnapshot().tabs).toHaveLength(0);
  });

  it("claims pre-account rows when an account signs in", () => {
    const { repo, service } = makeService();
    service.setAccountScope(alice);
    expect(repo._claimed).toEqual([alice]);
  });

  it("emits a snapshot change when the scope changes, but not on an equal scope", () => {
    const { service } = makeService();
    const emissions: TabsSnapshot[] = [];
    service.on(BrowserTabsEvent.SnapshotChange, (s) => emissions.push(s));

    service.setAccountScope({ ...alice });
    service.setAccountScope({ ...alice });
    expect(emissions).toHaveLength(1);

    service.setAccountScope(null);
    expect(emissions).toHaveLength(2);
  });

  it("clears the live snapshot on logout without erasing persisted tabs", () => {
    const { repo, service } = makeService();
    service.setAccountScope(alice);
    service.newBlankTab({ windowId: service.getPrimaryWindowId() });

    service.setAccountScope(null);
    service.newBlankTab({ windowId: service.getPrimaryWindowId() });

    expect(repo._snapshots.get(key(alice))?.tabs).toHaveLength(1);
  });

  it("ignores setActiveTab for a tab that is not in the window", () => {
    const { service } = makeService();
    service.setAccountScope(alice);
    const windowId = service.getPrimaryWindowId();
    openCanvasTab(service, "dash-a");
    const realTabId = service.getSnapshot().tabs[0]?.id;
    expect(service.getSnapshot().windows[0]?.activeTabId).toBe(realTabId);

    // Stale renderer state (e.g. router history from a previous account's
    // snapshot) must not leave the window pointing at a nonexistent tab.
    service.setActiveTab({ windowId, tabId: "ghost-tab" });
    expect(service.getSnapshot().windows[0]?.activeTabId).toBe(realTabId);

    service.setActiveTab({ windowId, tabId: null });
    expect(service.getSnapshot().windows[0]?.activeTabId).toBeNull();
  });
});
