import type { Task } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Bridge mocks: assert the store calls navigationBridge for every action
// instead of trying to drive a real router instance from the test runner.
const bridgeMocks = vi.hoisted(() => {
  const resolvedSubscribers: Array<() => void> = [];
  return {
    navigateToCode: vi.fn(),
    navigateToTaskDetail: vi.fn(),
    navigateToTaskPending: vi.fn(),
    navigateToFolderSettings: vi.fn(),
    navigateToInbox: vi.fn(),
    navigateToArchived: vi.fn(),
    navigateToCommandCenter: vi.fn(),
    navigateToSkills: vi.fn(),
    navigateToMcpServers: vi.fn(),
    navigateToSettings: vi.fn(),
    goBackInHistory: vi.fn(),
    goForwardInHistory: vi.fn(),
    isOnSettingsRoute: vi.fn(() => false),
    getCurrentMatches: vi.fn(() => [{ routeId: "/code/", params: {} }]),
    getCurrentLocation: vi.fn(() => ({ pathname: "/code/" })),
    subscribeToRouterResolved: vi.fn((fn: () => void) => {
      resolvedSubscribers.push(fn);
      return () => {
        const i = resolvedSubscribers.indexOf(fn);
        if (i >= 0) resolvedSubscribers.splice(i, 1);
      };
    }),
    _fireRouterResolved: () => {
      for (const fn of resolvedSubscribers) fn();
    },
  };
});

vi.mock("@renderer/navigationBridge", () => bridgeMocks);

vi.mock("@utils/analytics", () => ({
  track: vi.fn(),
  setActiveTaskAnalyticsContext: vi.fn(),
}));
vi.mock("@utils/logger", () => ({
  logger: { scope: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));
vi.mock("@utils/queryClient", () => ({
  getCachedTask: vi.fn(() => undefined),
  queryClient: {
    getQueryCache: () => ({ subscribe: vi.fn(() => () => {}) }),
  },
}));
vi.mock("@features/workspace/hooks/useWorkspace", () => ({
  workspaceApi: {
    get: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("@features/folders/hooks/useFolders", () => ({
  foldersApi: {
    getFolders: vi.fn().mockResolvedValue([]),
    addFolder: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("@hooks/useRepositoryDirectory", () => ({
  getTaskDirectory: vi.fn().mockResolvedValue(null),
}));

import { useTaskInputPrefillStore } from "@features/task-detail/stores/taskInputPrefillStore";
import { useNavigationStore } from "./navigationStore";

const mockTask: Task = {
  id: "task-123",
  task_number: 1,
  slug: "test-task",
  title: "Test task",
  description: "Test task description",
  origin_product: "twig",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

describe("navigationStore (router-derived facade)", () => {
  beforeEach(() => {
    for (const fn of Object.values(bridgeMocks)) {
      if (typeof fn === "function" && "mockClear" in fn) fn.mockClear();
    }
    useTaskInputPrefillStore.setState({ prefill: {} });
    bridgeMocks.getCurrentMatches.mockReturnValue([
      { routeId: "/code/", params: {} },
    ]);
  });

  // Trigger the store's router-resolved subscriber after changing
  // getCurrentMatches; the store batches via queueMicrotask so we await it.
  async function flushRouterChange(): Promise<void> {
    bridgeMocks._fireRouterResolved();
    await Promise.resolve();
  }

  describe("view derivation", () => {
    it("returns task-input for the /code/ route", async () => {
      await flushRouterChange();
      expect(useNavigationStore.getState().view.type).toBe("task-input");
    });

    it("returns task-detail with taskId from URL params", async () => {
      bridgeMocks.getCurrentMatches.mockReturnValue([
        { routeId: "/code/tasks/$taskId", params: { taskId: "task-99" } },
      ]);
      await flushRouterChange();
      const view = useNavigationStore.getState().view;
      expect(view).toMatchObject({ type: "task-detail", taskId: "task-99" });
    });

    it("returns inbox/archived/command-center/skills/mcp-servers per route", async () => {
      const cases: Array<[string, string]> = [
        ["/code/inbox", "inbox"],
        ["/code/archived", "archived"],
        ["/command-center", "command-center"],
        ["/skills", "skills"],
        ["/mcp-servers", "mcp-servers"],
      ];
      for (const [routeId, expected] of cases) {
        bridgeMocks.getCurrentMatches.mockReturnValue([
          { routeId, params: {} },
        ]);
        await flushRouterChange();
        expect(useNavigationStore.getState().view.type).toBe(expected);
      }
    });

    it("pulls task-input prefill from useTaskInputPrefillStore", async () => {
      useTaskInputPrefillStore.setState({
        prefill: { initialPrompt: "hello", requestId: "req-1" },
      });
      await flushRouterChange();
      const view = useNavigationStore.getState().view;
      expect(view).toMatchObject({
        type: "task-input",
        initialPrompt: "hello",
        taskInputRequestId: "req-1",
      });
    });
  });

  describe("actions delegate to navigationBridge", () => {
    it("navigateToTask calls bridge with the task id", async () => {
      await useNavigationStore.getState().navigateToTask(mockTask);
      expect(bridgeMocks.navigateToTaskDetail).toHaveBeenCalledWith("task-123");
    });

    it("navigateToTaskInput writes prefill and navigates to /code", () => {
      useNavigationStore
        .getState()
        .navigateToTaskInput({ initialPrompt: "draft" });
      expect(useTaskInputPrefillStore.getState().prefill.initialPrompt).toBe(
        "draft",
      );
      expect(bridgeMocks.navigateToCode).toHaveBeenCalled();
    });

    it("navigateToInbox/archived/etc. call the matching bridge function", () => {
      const s = useNavigationStore.getState();
      s.navigateToInbox();
      s.navigateToArchived();
      s.navigateToCommandCenter();
      s.navigateToSkills();
      s.navigateToMcpServers();
      s.navigateToFolderSettings("folder-1");
      s.navigateToPendingTask("pending-1");
      expect(bridgeMocks.navigateToInbox).toHaveBeenCalled();
      expect(bridgeMocks.navigateToArchived).toHaveBeenCalled();
      expect(bridgeMocks.navigateToCommandCenter).toHaveBeenCalled();
      expect(bridgeMocks.navigateToSkills).toHaveBeenCalled();
      expect(bridgeMocks.navigateToMcpServers).toHaveBeenCalled();
      expect(bridgeMocks.navigateToFolderSettings).toHaveBeenCalledWith(
        "folder-1",
      );
      expect(bridgeMocks.navigateToTaskPending).toHaveBeenCalledWith(
        "pending-1",
      );
    });

    it("goBack/goForward call router history", () => {
      useNavigationStore.getState().goBack();
      useNavigationStore.getState().goForward();
      expect(bridgeMocks.goBackInHistory).toHaveBeenCalled();
      expect(bridgeMocks.goForwardInHistory).toHaveBeenCalled();
    });

    it("clearTaskInputReportAssociation clears the prefill store", () => {
      useTaskInputPrefillStore.setState({
        prefill: {
          reportAssociation: { reportId: "r1", title: "t" },
          initialCloudRepository: "owner/repo",
        },
      });
      useNavigationStore.getState().clearTaskInputReportAssociation();
      const prefill = useTaskInputPrefillStore.getState().prefill;
      expect(prefill.reportAssociation).toBeUndefined();
      expect(prefill.initialCloudRepository).toBeUndefined();
    });
  });

  describe("legacy compatibility shims", () => {
    it("history/historyIndex stay stubbed", () => {
      const s = useNavigationStore.getState();
      expect(s.history).toEqual([]);
      expect(s.historyIndex).toBe(0);
    });

    it("hydrateTask is a no-op (URL is source of truth)", () => {
      expect(() =>
        useNavigationStore.getState().hydrateTask([mockTask]),
      ).not.toThrow();
    });

    it("setState logs a warning and does nothing", () => {
      const before = useNavigationStore.getState().view;
      useNavigationStore.setState({ view: { type: "inbox" } });
      expect(useNavigationStore.getState().view).toEqual(before);
    });
  });
});
