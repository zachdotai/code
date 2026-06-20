import type { TaskData } from "@posthog/core/sidebar/sidebarData.types";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { renderCounts } = vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  return { renderCounts: new Map<string, number>() };
});

vi.mock("@posthog/ui/features/sidebar/components/items/TaskItem", () => ({
  TaskItem: ({ taskId }: { taskId: string }) => {
    renderCounts.set(taskId, (renderCounts.get(taskId) ?? 0) + 1);
    return null;
  },
}));

vi.mock("@posthog/ui/features/workspace/useWorkspace", () => ({
  useWorkspace: () => undefined,
}));
vi.mock("@posthog/ui/features/sidebar/useTaskPrStatus", () => ({
  useTaskPrStatus: () => ({ prState: null, hasDiff: false }),
}));
vi.mock("@posthog/ui/features/sidebar/archivingTasksStore", () => ({
  useArchivingTasksStore: (
    selector: (s: { archivingTaskIds: Set<string> }) => unknown,
  ) => selector({ archivingTaskIds: new Set<string>() }),
}));
vi.mock("@posthog/ui/features/folders/useFolders", () => ({
  useFolders: () => ({ folders: [] }),
}));
vi.mock("@posthog/ui/router/useAppView", () => ({
  useAppView: () => ({ type: "task-detail" }),
}));
vi.mock("@posthog/ui/router/useOpenTask", () => ({ openTaskInput: vi.fn() }));
vi.mock("@posthog/ui/assets/hedgehogs", () => ({ builderHog: "" }));
vi.mock("@posthog/ui/features/sidebar/sidebarStore", () => {
  const state = {
    organizeMode: "recent",
    sortMode: "updated",
    collapsedSections: new Set<string>(),
    toggleSection: () => {},
    loadMoreHistory: () => {},
    resetHistoryVisibleCount: () => {},
    folderOrder: [] as string[],
    reorderFolders: () => {},
  };
  return {
    useSidebarStore: Object.assign(
      (selector: (s: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});

import { TaskListView } from "./TaskListView";

function makeTask(i: number): TaskData {
  return {
    id: `task-${i}`,
    title: `Task ${i}`,
    createdAt: 1000 + i,
    lastActivityAt: 1000 + i,
    isGenerating: false,
    isUnread: false,
    isPinned: true,
    needsPermission: false,
    repository: null,
    isSuspended: false,
    folderPath: null,
    cloudPrUrl: null,
    branchName: null,
    linkedBranch: null,
  };
}

describe("TaskListView memoization", () => {
  beforeEach(() => renderCounts.clear());

  it("re-renders only the two affected rows when the active task changes", () => {
    const tasks = Array.from({ length: 20 }, (_, i) => makeTask(i));
    const props = {
      pinnedTasks: tasks,
      flatTasks: [],
      groupedTasks: [],
      editingTaskId: null,
      selectedTaskIds: [],
      hasMore: false,
      onTaskClick: vi.fn(),
      onTaskDoubleClick: vi.fn(),
      onTaskContextMenu: vi.fn(),
      onTaskArchive: vi.fn(),
      onTaskTogglePin: vi.fn(),
      onTaskEditSubmit: vi.fn(),
      onTaskEditCancel: vi.fn(),
    };

    const { rerender } = render(
      <TaskListView {...props} activeTaskId="task-0" />,
    );
    expect(renderCounts.size).toBe(20);

    renderCounts.clear();
    rerender(<TaskListView {...props} activeTaskId="task-1" />);

    expect([...renderCounts.keys()].sort()).toEqual(["task-0", "task-1"]);
  });
});
