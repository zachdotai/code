import type { Task } from "@posthog/shared/domain-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => new Map<symbol, unknown>());

vi.mock("@posthog/di/container", () => ({
  resolveService: (token: symbol) => services.get(token),
}));

vi.mock("@posthog/ui/shell/logger", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { HOST_TRPC_CLIENT } from "@posthog/host-router/client";
import { WORKSPACE_QUERY_KEY } from "@posthog/ui/features/workspace/identifiers";
import { IMPERATIVE_QUERY_CLIENT } from "@posthog/ui/shell/queryClient";
import { navigationTaskBinder } from "./taskBinderImpl";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Test task",
    description: "Ship the fix",
    repository: "posthog/code",
    latest_run: null,
    ...overrides,
  } as Task;
}

function setup({
  workspaces = {},
  folders = [] as Array<{ id: string; path: string; exists: boolean }>,
  repositoryPath = null as string | null,
} = {}) {
  const workspaceGetAll = vi.fn().mockResolvedValue(workspaces);
  const workspaceCreate = vi.fn().mockResolvedValue(undefined);
  const foldersGetFolders = vi.fn().mockResolvedValue(folders);
  const addFolder = vi.fn().mockResolvedValue(undefined);
  const getRepositoryByRemoteUrl = vi
    .fn()
    .mockResolvedValue(repositoryPath ? { path: repositoryPath } : null);
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);

  services.set(HOST_TRPC_CLIENT, {
    workspace: {
      getAll: { query: workspaceGetAll },
      create: { mutate: workspaceCreate },
    },
    folders: {
      getFolders: { query: foldersGetFolders },
      addFolder: { mutate: addFolder },
      getRepositoryByRemoteUrl: { query: getRepositoryByRemoteUrl },
    },
  });
  services.set(IMPERATIVE_QUERY_CLIENT, { invalidateQueries });

  return {
    workspaceCreate,
    addFolder,
    getRepositoryByRemoteUrl,
    invalidateQueries,
  };
}

beforeEach(() => {
  services.clear();
});

describe("navigationTaskBinder.ensureWorkspaceForTask", () => {
  it("defers workspace creation for a task with no run", async () => {
    const { workspaceCreate, addFolder, getRepositoryByRemoteUrl } = setup({
      repositoryPath: "/repo",
    });
    const task = makeTask();

    const result = await navigationTaskBinder.ensureWorkspaceForTask(task);

    expect(result).toBeUndefined();
    expect(getRepositoryByRemoteUrl).not.toHaveBeenCalled();
    expect(addFolder).not.toHaveBeenCalled();
    expect(workspaceCreate).not.toHaveBeenCalled();
  });

  it.each([
    { environment: "local", mode: "local" },
    { environment: "cloud", mode: "cloud" },
  ])(
    "binds a $environment run with a resolved directory as mode $mode",
    async ({ environment, mode }) => {
      const { workspaceCreate, addFolder, invalidateQueries } = setup({
        repositoryPath: "/repo",
      });
      const task = makeTask({
        latest_run: { id: "run-1", environment } as Task["latest_run"],
      });

      await navigationTaskBinder.ensureWorkspaceForTask(task);

      expect(addFolder).toHaveBeenCalledWith({ folderPath: "/repo" });
      expect(workspaceCreate).toHaveBeenCalledWith({
        taskId: task.id,
        mainRepoPath: "/repo",
        folderId: "",
        folderPath: "/repo",
        mode,
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: WORKSPACE_QUERY_KEY,
      });
    },
  );

  it("creates a cloud workspace when a cloud run resolves no directory", async () => {
    const { workspaceCreate, invalidateQueries } = setup();
    const task = makeTask({
      latest_run: { id: "run-1", environment: "cloud" } as Task["latest_run"],
    });

    await navigationTaskBinder.ensureWorkspaceForTask(task);

    expect(workspaceCreate).toHaveBeenCalledWith({
      taskId: task.id,
      mainRepoPath: "",
      folderId: "",
      folderPath: "",
      mode: "cloud",
    });
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it("does nothing when a local run resolves no directory", async () => {
    const { workspaceCreate, invalidateQueries } = setup();
    const task = makeTask({
      latest_run: { id: "run-1", environment: "local" } as Task["latest_run"],
    });

    await navigationTaskBinder.ensureWorkspaceForTask(task);

    expect(workspaceCreate).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("reuses an existing workspace whose folder is still live", async () => {
    const { workspaceCreate, invalidateQueries } = setup({
      workspaces: { "task-1": { folderId: "f1" } },
      folders: [{ id: "f1", path: "/repo", exists: true }],
    });
    const task = makeTask({
      latest_run: { id: "run-1", environment: "local" } as Task["latest_run"],
    });

    const result = await navigationTaskBinder.ensureWorkspaceForTask(task);

    expect(result).toBeUndefined();
    expect(workspaceCreate).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("does not invalidate the workspace cache when creation fails", async () => {
    const { workspaceCreate, invalidateQueries } = setup({
      repositoryPath: "/repo",
    });
    workspaceCreate.mockRejectedValueOnce(new Error("db locked"));
    const task = makeTask({
      latest_run: { id: "run-1", environment: "local" } as Task["latest_run"],
    });

    await navigationTaskBinder.ensureWorkspaceForTask(task);

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
