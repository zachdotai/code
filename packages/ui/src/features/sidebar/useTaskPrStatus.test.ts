import { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import { taskPrStatusEntity } from "@posthog/core/tasks/taskSync";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskData } from "./useSidebarData";
import { useTaskPrStatus } from "./useTaskPrStatus";

const holder = vi.hoisted(() => ({ registry: null as unknown }));

vi.mock("@posthog/di/react", () => ({
  useService: () => holder.registry,
}));

function makeTask(overrides: Partial<TaskData> = {}): TaskData {
  return {
    id: "task-1",
    title: "Test task",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    isGenerating: false,
    isUnread: false,
    isPinned: false,
    needsPermission: false,
    repository: null,
    isSuspended: false,
    taskRunEnvironment: "local" as const,
    folderPath: "/repo",
    cloudPrUrl: null,
    branchName: "feat/test",
    linkedBranch: null,
    ...overrides,
  };
}

describe("useTaskPrStatus", () => {
  let registry: EntityRegistry;

  beforeEach(() => {
    registry = new EntityRegistry();
    registry.register(taskPrStatusEntity);
    holder.registry = registry;
  });

  function seed(id: string, prState: string | null, hasDiff: boolean) {
    registry
      .getPool(taskPrStatusEntity.name)
      .applyUpserts([{ id, prState, hasDiff } as never], { persist: false });
  }

  it("returns empty status when the pool has no row", () => {
    const { result } = renderHook(() => useTaskPrStatus(makeTask()));
    expect(result.current).toEqual({ prState: null, hasDiff: false });
  });

  it("returns empty status when the row has no prState and no diff", () => {
    seed("task-1", null, false);
    const { result } = renderHook(() => useTaskPrStatus(makeTask()));
    expect(result.current).toEqual({ prState: null, hasDiff: false });
  });

  it("returns prState from the pool", () => {
    seed("task-1", "open", false);
    const { result } = renderHook(() => useTaskPrStatus(makeTask()));
    expect(result.current).toEqual({ prState: "open", hasDiff: false });
  });

  it("returns hasDiff from the pool", () => {
    seed("task-1", null, true);
    const { result } = renderHook(() => useTaskPrStatus(makeTask()));
    expect(result.current).toEqual({ prState: null, hasDiff: true });
  });

  it("returns both prState and hasDiff from the pool", () => {
    seed("task-1", "merged", true);
    const { result } = renderHook(() => useTaskPrStatus(makeTask()));
    expect(result.current).toEqual({ prState: "merged", hasDiff: true });
  });

  it("re-renders when the pool row changes", () => {
    seed("task-1", null, false);
    const { result, rerender } = renderHook(() => useTaskPrStatus(makeTask()));
    expect(result.current.prState).toBeNull();

    seed("task-1", "draft", false);
    rerender();
    expect(result.current.prState).toBe("draft");
  });
});
