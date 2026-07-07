import type { Schemas } from "@posthog/api-client";
import type { TaskChannel } from "@posthog/shared/domain-types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => ({
  getDesktopFileSystemChannels: vi.fn(),
  createDesktopFileSystemChannel: vi.fn(),
  renameDesktopFileSystemChannel: vi.fn(),
  deleteDesktopFileSystem: vi.fn(),
  getTaskChannels: vi.fn(),
  renameTaskChannel: vi.fn(),
  deleteTaskChannel: vi.fn(),
  getTasks: vi.fn(),
  deleteTask: vi.fn(),
}));
vi.mock("@posthog/ui/features/auth/authClient", () => ({
  useOptionalAuthenticatedClient: () => mockClient,
}));

import { useChannelMutations, useChannels } from "./useChannels";

function folder(id: string, path: string): Schemas.FileSystem {
  return {
    id,
    path,
    type: "folder",
    depth: 1,
    created_at: "2026-01-01T00:00:00Z",
    last_viewed_at: null,
  };
}

let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useChannelMutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("shows the created channel immediately, before the refetch resolves", async () => {
    // Seed the list with one existing channel.
    mockClient.getDesktopFileSystemChannels.mockResolvedValue([
      folder("1", "alpha"),
    ]);

    const list = renderHook(() => useChannels(), { wrapper });
    await waitFor(() => expect(list.result.current.isLoading).toBe(false));
    expect(list.result.current.channels.map((c) => c.name)).toEqual(["alpha"]);

    // Make the create return the new channel, but hang any subsequent refetch
    // so we can prove the list updates without waiting on it.
    const created = folder("2", "beta");
    mockClient.createDesktopFileSystemChannel.mockResolvedValue(created);
    mockClient.getDesktopFileSystemChannels.mockReturnValue(
      new Promise(() => {}),
    );

    const mutations = renderHook(() => useChannelMutations(), { wrapper });
    await act(async () => {
      await mutations.result.current.createChannel("beta");
    });

    // The new channel is present from the optimistic cache write, sorted
    // alphabetically alongside the existing one — without the hung refetch
    // having resolved.
    await waitFor(() =>
      expect(list.result.current.channels.map((c) => c.name)).toEqual([
        "alpha",
        "beta",
      ]),
    );
  });

  it("does not duplicate a channel the poll already landed", async () => {
    // The poll has already surfaced the channel we're about to create.
    const existing = folder("1", "alpha");
    mockClient.getDesktopFileSystemChannels.mockResolvedValue([existing]);

    const list = renderHook(() => useChannels(), { wrapper });
    await waitFor(() => expect(list.result.current.isLoading).toBe(false));
    expect(list.result.current.channels.map((c) => c.id)).toEqual(["1"]);

    // Create returns the same id; hang the refetch so only the optimistic
    // cache write is exercised.
    mockClient.createDesktopFileSystemChannel.mockResolvedValue(existing);
    mockClient.getDesktopFileSystemChannels.mockReturnValue(
      new Promise(() => {}),
    );

    const mutations = renderHook(() => useChannelMutations(), { wrapper });
    await act(async () => {
      await mutations.result.current.createChannel("alpha");
    });

    // The duplicate-id guard keeps the list at one entry.
    expect(list.result.current.channels.map((c) => c.id)).toEqual(["1"]);
  });
});

describe("useChannelMutations rename", () => {
  function taskChannel(
    id: string,
    name: string,
    channel_type: TaskChannel["channel_type"] = "public",
  ): TaskChannel {
    return { id, name, channel_type, created_at: "2026-01-01T00:00:00Z" };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("renames the backend task channel alongside the folder", async () => {
    // The feed's backend channel is looked up by name, so a folder rename
    // must carry it along or the channel's tasks/messages are orphaned.
    mockClient.getTaskChannels.mockResolvedValue([
      taskChannel("bc-1", "mobile"),
      taskChannel("bc-2", "web"),
    ]);
    mockClient.renameTaskChannel.mockResolvedValue(
      taskChannel("bc-1", "mobile-app"),
    );
    mockClient.renameDesktopFileSystemChannel.mockResolvedValue(
      folder("1", "mobile-app"),
    );

    const mutations = renderHook(() => useChannelMutations(), { wrapper });
    await act(async () => {
      await mutations.result.current.renameChannel("1", "mobile-app", "mobile");
    });

    expect(mockClient.renameTaskChannel).toHaveBeenCalledWith(
      "bc-1",
      "mobile-app",
    );
    expect(mockClient.renameDesktopFileSystemChannel).toHaveBeenCalledWith(
      "1",
      "mobile-app",
    );
  });

  it("skips the backend rename when no backend channel has the old name", async () => {
    mockClient.getTaskChannels.mockResolvedValue([taskChannel("bc-2", "web")]);
    mockClient.renameDesktopFileSystemChannel.mockResolvedValue(
      folder("1", "mobile-app"),
    );

    const mutations = renderHook(() => useChannelMutations(), { wrapper });
    await act(async () => {
      await mutations.result.current.renameChannel("1", "mobile-app", "mobile");
    });

    expect(mockClient.renameTaskChannel).not.toHaveBeenCalled();
    expect(mockClient.renameDesktopFileSystemChannel).toHaveBeenCalledWith(
      "1",
      "mobile-app",
    );
  });

  it("does not rename the folder when the backend rename fails", async () => {
    mockClient.getTaskChannels.mockResolvedValue([
      taskChannel("bc-1", "mobile"),
    ]);
    mockClient.renameTaskChannel.mockRejectedValue(new Error("name taken"));

    const mutations = renderHook(() => useChannelMutations(), { wrapper });
    await expect(
      act(() =>
        mutations.result.current.renameChannel("1", "mobile-app", "mobile"),
      ),
    ).rejects.toThrow("name taken");

    expect(mockClient.renameDesktopFileSystemChannel).not.toHaveBeenCalled();
  });

  it("reverts the backend rename when the folder rename fails", async () => {
    mockClient.getTaskChannels.mockResolvedValue([
      taskChannel("bc-1", "mobile"),
    ]);
    mockClient.renameTaskChannel.mockResolvedValue(
      taskChannel("bc-1", "mobile-app"),
    );
    mockClient.renameDesktopFileSystemChannel.mockRejectedValue(
      new Error("folder rename failed"),
    );

    const mutations = renderHook(() => useChannelMutations(), { wrapper });
    await expect(
      act(() =>
        mutations.result.current.renameChannel("1", "mobile-app", "mobile"),
      ),
    ).rejects.toThrow("folder rename failed");

    expect(mockClient.renameTaskChannel).toHaveBeenNthCalledWith(
      1,
      "bc-1",
      "mobile-app",
    );
    expect(mockClient.renameTaskChannel).toHaveBeenNthCalledWith(
      2,
      "bc-1",
      "mobile",
    );
  });
});

describe("useChannelMutations delete", () => {
  function taskChannel(
    id: string,
    name: string,
    channel_type: TaskChannel["channel_type"] = "public",
  ): TaskChannel {
    return { id, name, channel_type, created_at: "2026-01-01T00:00:00Z" };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("soft-deletes the backend channel's tasks and the channel before the folder", async () => {
    mockClient.getTaskChannels.mockResolvedValue([
      taskChannel("bc-1", "mobile"),
      taskChannel("bc-2", "web"),
    ]);
    mockClient.getTasks.mockResolvedValue([{ id: "t-1" }, { id: "t-2" }]);
    mockClient.deleteTask.mockResolvedValue(undefined);
    mockClient.deleteTaskChannel.mockResolvedValue(undefined);
    mockClient.deleteDesktopFileSystem.mockResolvedValue(undefined);

    const mutations = renderHook(() => useChannelMutations(), { wrapper });
    await act(async () => {
      await mutations.result.current.deleteChannel("1", "mobile");
    });

    expect(mockClient.getTasks).toHaveBeenCalledWith({ channel: "bc-1" });
    expect(mockClient.deleteTask).toHaveBeenCalledWith("t-1");
    expect(mockClient.deleteTask).toHaveBeenCalledWith("t-2");
    expect(mockClient.deleteTaskChannel).toHaveBeenCalledWith("bc-1");
    expect(mockClient.deleteDesktopFileSystem).toHaveBeenCalledWith("1");
  });

  it("deletes just the folder when no backend channel matches the name", async () => {
    mockClient.getTaskChannels.mockResolvedValue([taskChannel("bc-2", "web")]);
    mockClient.deleteDesktopFileSystem.mockResolvedValue(undefined);

    const mutations = renderHook(() => useChannelMutations(), { wrapper });
    await act(async () => {
      await mutations.result.current.deleteChannel("1", "mobile");
    });

    expect(mockClient.getTasks).not.toHaveBeenCalled();
    expect(mockClient.deleteTaskChannel).not.toHaveBeenCalled();
    expect(mockClient.deleteDesktopFileSystem).toHaveBeenCalledWith("1");
  });

  it("still deletes the backend channel when a task soft delete fails", async () => {
    // Task deletes are best-effort: a straggler stays attached to the
    // soft-deleted channel (recoverable) rather than blocking the delete.
    mockClient.getTaskChannels.mockResolvedValue([
      taskChannel("bc-1", "mobile"),
    ]);
    mockClient.getTasks.mockResolvedValue([{ id: "t-1" }, { id: "t-2" }]);
    mockClient.deleteTask
      .mockRejectedValueOnce(new Error("task delete failed"))
      .mockResolvedValueOnce(undefined);
    mockClient.deleteTaskChannel.mockResolvedValue(undefined);
    mockClient.deleteDesktopFileSystem.mockResolvedValue(undefined);

    const mutations = renderHook(() => useChannelMutations(), { wrapper });
    await act(async () => {
      await mutations.result.current.deleteChannel("1", "mobile");
    });

    expect(mockClient.deleteTaskChannel).toHaveBeenCalledWith("bc-1");
    expect(mockClient.deleteDesktopFileSystem).toHaveBeenCalledWith("1");
  });

  it("does not delete the folder when the backend channel delete fails", async () => {
    mockClient.getTaskChannels.mockResolvedValue([
      taskChannel("bc-1", "mobile"),
    ]);
    mockClient.getTasks.mockResolvedValue([]);
    mockClient.deleteTaskChannel.mockRejectedValue(
      new Error("channel delete failed"),
    );

    const mutations = renderHook(() => useChannelMutations(), { wrapper });
    await expect(
      act(() => mutations.result.current.deleteChannel("1", "mobile")),
    ).rejects.toThrow("channel delete failed");

    expect(mockClient.deleteDesktopFileSystem).not.toHaveBeenCalled();
  });
});
