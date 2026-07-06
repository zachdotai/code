import type { TabsSnapshot } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import type { IBrowserTabsRepository } from "../../db/repositories/browser-tabs-repository";
import { BrowserTabsEvent } from "./schemas";
import { BrowserTabsService } from "./service";

class FakeRepo implements IBrowserTabsRepository {
  store = new Map<string, TabsSnapshot>();
  claimed: string[] = [];

  load(accountScope: string): TabsSnapshot {
    return this.store.get(accountScope) ?? { windows: [], tabs: [] };
  }

  save(accountScope: string, snapshot: TabsSnapshot): void {
    this.store.set(accountScope, snapshot);
  }

  claimUnscoped(accountScope: string): void {
    this.claimed.push(accountScope);
  }
}

const makeService = () => {
  const repo = new FakeRepo();
  const service = new BrowserTabsService(repo);
  return { repo, service };
};

describe("BrowserTabsService account scoping", () => {
  it("starts signed out with a memory-only primary window", () => {
    const { repo, service } = makeService();
    expect(service.getPrimaryWindowId()).toBeTruthy();
    expect(repo.store.size).toBe(0);
  });

  it("does not persist mutations while signed out", () => {
    const { repo, service } = makeService();
    service.newBlankTab({ windowId: service.getPrimaryWindowId() });
    expect(repo.store.size).toBe(0);
  });

  it("persists mutations under the signed-in account's scope", () => {
    const { repo, service } = makeService();
    service.setAccountScope("us:alice");
    service.newBlankTab({ windowId: service.getPrimaryWindowId() });
    expect(repo.store.get("us:alice")?.tabs).toHaveLength(1);
  });

  it("restores each account's tabs when switching users", () => {
    const { service } = makeService();

    service.setAccountScope("us:alice");
    service.newBlankTab({ windowId: service.getPrimaryWindowId() });
    const aliceTabs = service.getSnapshot().tabs.map((t) => t.id);
    expect(aliceTabs).toHaveLength(1);

    // Logout then login as bob: blank strip, none of alice's tabs.
    service.setAccountScope(null);
    expect(service.getSnapshot().tabs).toHaveLength(0);
    service.setAccountScope("us:bob");
    expect(service.getSnapshot().tabs).toHaveLength(0);
    service.newBlankTab({ windowId: service.getPrimaryWindowId() });
    service.newBlankTab({ windowId: service.getPrimaryWindowId() });

    // Back to alice: her single tab comes back.
    service.setAccountScope(null);
    service.setAccountScope("us:alice");
    expect(service.getSnapshot().tabs.map((t) => t.id)).toEqual(aliceTabs);
  });

  it("claims pre-account rows when an account signs in", () => {
    const { repo, service } = makeService();
    service.setAccountScope("us:alice");
    expect(repo.claimed).toEqual(["us:alice"]);
  });

  it("emits a snapshot change when the scope changes, but not on a repeat", () => {
    const { service } = makeService();
    const emissions: TabsSnapshot[] = [];
    service.on(BrowserTabsEvent.SnapshotChange, (s) => emissions.push(s));

    service.setAccountScope("us:alice");
    service.setAccountScope("us:alice");
    expect(emissions).toHaveLength(1);

    service.setAccountScope(null);
    expect(emissions).toHaveLength(2);
  });

  it("clears the live snapshot on logout without erasing persisted tabs", () => {
    const { repo, service } = makeService();
    service.setAccountScope("us:alice");
    service.newBlankTab({ windowId: service.getPrimaryWindowId() });

    service.setAccountScope(null);
    service.newBlankTab({ windowId: service.getPrimaryWindowId() });

    expect(repo.store.get("us:alice")?.tabs).toHaveLength(1);
  });
});
