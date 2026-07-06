import { beforeEach, describe, expect, it } from "vitest";
import {
  addBrowserTab,
  addRecentFile,
  closeTab,
  createInitialTaskLayout,
  openTab,
  updateBrowserTabUrl,
  updateTabLabel,
  updateTabMetadata,
} from "./panelLayoutTransforms";
import { createFileTabId, resetPanelIdCounter } from "./panelStoreHelpers";
import { findTabInTree } from "./panelTree";
import type { TaskLayout } from "./panelTypes";

function applyUpdates(
  layout: TaskLayout,
  updates: Partial<TaskLayout>,
): TaskLayout {
  return { ...layout, ...updates };
}

describe("panelLayoutTransforms", () => {
  beforeEach(() => {
    resetPanelIdCounter();
  });

  describe("createInitialTaskLayout", () => {
    it("creates a leaf main panel with logs and shell tabs", () => {
      const layout = createInitialTaskLayout();
      expect(layout.panelTree.type).toBe("leaf");
      if (layout.panelTree.type !== "leaf") return;
      expect(layout.panelTree.content.tabs.map((t) => t.id)).toEqual([
        "logs",
        "shell",
      ]);
      expect(layout.panelTree.content.activeTabId).toBe("logs");
    });
  });

  describe("openTab", () => {
    it("adds a new file tab to the main panel", () => {
      const layout = createInitialTaskLayout();
      const tabId = createFileTabId("src/App.tsx");
      const next = applyUpdates(layout, openTab(layout, tabId, false));

      expect(findTabInTree(next.panelTree, tabId)).not.toBeNull();
      expect(next.panelTree.type).toBe("leaf");
      if (next.panelTree.type !== "leaf") return;
      expect(next.panelTree.content.tabs.length).toBe(3);
      expect(next.panelTree.content.activeTabId).toBe(tabId);
    });

    it("activates an existing tab instead of duplicating it", () => {
      const layout = createInitialTaskLayout();
      const tabId = createFileTabId("src/App.tsx");
      const opened = applyUpdates(layout, openTab(layout, tabId, false));
      const reopened = applyUpdates(opened, openTab(opened, tabId, false));

      if (reopened.panelTree.type !== "leaf") return;
      const occurrences = reopened.panelTree.content.tabs.filter(
        (t) => t.id === tabId,
      );
      expect(occurrences.length).toBe(1);
    });
  });

  describe("closeTab", () => {
    it("removes the tab and selects a fallback", () => {
      const layout = createInitialTaskLayout();
      const tabId = createFileTabId("src/App.tsx");
      const opened = applyUpdates(layout, openTab(layout, tabId, false));
      const closed = applyUpdates(
        opened,
        closeTab(opened, "main-panel", tabId),
      );

      expect(findTabInTree(closed.panelTree, tabId)).toBeNull();
    });
  });

  describe("addBrowserTab", () => {
    it("adds a browser tab carrying the initial url", () => {
      const layout = createInitialTaskLayout();
      const next = applyUpdates(
        layout,
        addBrowserTab(layout, "main-panel", "https://posthog.com"),
      );

      expect(next.panelTree.type).toBe("leaf");
      if (next.panelTree.type !== "leaf") return;
      const browserTab = next.panelTree.content.tabs.find(
        (t) => t.data.type === "browser",
      );
      expect(browserTab).toBeDefined();
      expect(browserTab?.data).toEqual({
        type: "browser",
        url: "https://posthog.com",
      });
    });
  });

  describe("updateBrowserTabUrl", () => {
    it("updates the url of an existing browser tab", () => {
      const layout = createInitialTaskLayout();
      const added = applyUpdates(
        layout,
        addBrowserTab(layout, "main-panel", "about:blank"),
      );
      expect(added.panelTree.type).toBe("leaf");
      if (added.panelTree.type !== "leaf") return;
      const tabId = added.panelTree.content.tabs.find(
        (t) => t.data.type === "browser",
      )?.id;
      if (!tabId) throw new Error("expected browser tab");

      const next = applyUpdates(
        added,
        updateBrowserTabUrl(added, tabId, "https://example.com"),
      );

      const location = findTabInTree(next.panelTree, tabId);
      expect(location?.tab.data).toEqual({
        type: "browser",
        url: "https://example.com",
      });
    });

    it("leaves a non-browser tab untouched", () => {
      const layout = createInitialTaskLayout();
      const next = applyUpdates(
        layout,
        updateBrowserTabUrl(layout, "shell", "https://example.com"),
      );
      // The shell tab has no url; the guard must not graft one on.
      expect(findTabInTree(next.panelTree, "shell")?.tab.data).toEqual(
        findTabInTree(layout.panelTree, "shell")?.tab.data,
      );
    });
  });

  describe("updateTabLabel", () => {
    it("renames an existing tab", () => {
      const layout = createInitialTaskLayout();
      const next = applyUpdates(
        layout,
        updateTabLabel(layout, "shell", "Renamed"),
      );
      expect(findTabInTree(next.panelTree, "shell")?.tab.label).toBe("Renamed");
    });

    it("no-ops when the tab is gone", () => {
      const layout = createInitialTaskLayout();
      expect(updateTabLabel(layout, "missing", "X")).toEqual({});
    });
  });

  describe("updateTabMetadata", () => {
    it("merges metadata into an existing tab", () => {
      const layout = createInitialTaskLayout();
      const next = applyUpdates(
        layout,
        updateTabMetadata(layout, "shell", { hasUnsavedChanges: true }),
      );
      expect(
        findTabInTree(next.panelTree, "shell")?.tab.hasUnsavedChanges,
      ).toBe(true);
    });

    it("no-ops when the tab is gone", () => {
      const layout = createInitialTaskLayout();
      expect(
        updateTabMetadata(layout, "missing", { hasUnsavedChanges: true }),
      ).toEqual({});
    });
  });

  describe("addRecentFile", () => {
    it("dedupes and prepends, capping at the max", () => {
      const result = addRecentFile(["b", "a"], "a");
      expect(result).toEqual(["a", "b"]);
    });

    it("caps at MAX_RECENT_FILES", () => {
      const initial = Array.from({ length: 12 }, (_, i) => `f${i}`);
      const result = addRecentFile(initial, "new");
      expect(result.length).toBe(10);
      expect(result[0]).toBe("new");
    });
  });
});
