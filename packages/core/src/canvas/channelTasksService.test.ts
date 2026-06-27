import { describe, expect, it, vi } from "vitest";
import { ChannelTasksService } from "./channelTasksService";
import type { DesktopFsClient, FsEntryBase } from "./desktopFsClient";

// A task FS row carrying a `ref` (the task id) under the channel folder, as the
// backend returns it from a parent-scoped list.
function taskRow(id: string, taskId: string, createdAt: string): FsEntryBase {
  return {
    id,
    path: `Channels/chan-1/${id}`,
    type: "task",
    ref: taskId,
    created_at: createdAt,
  } as FsEntryBase;
}

// A fake DesktopFsClient exposing the two methods `list` touches: getEntry (to
// resolve the channel folder path) and fetch (the parent-scoped list GET).
function fakeFs(rows: FsEntryBase[]) {
  const fetch = vi.fn(async (_suffix: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ results: rows }),
  }));
  const getEntry = vi.fn(async (id: string) => ({
    id,
    path: `Channels/${id}`,
  }));
  const fs = { getEntry, fetch } as unknown as DesktopFsClient;
  return { fs, fetch, getEntry };
}

describe("ChannelTasksService.list", () => {
  it("uses a known channelPath without resolving it via getEntry", async () => {
    const { fs, fetch, getEntry } = fakeFs([]);
    const service = new ChannelTasksService(fs);

    await service.list("chan-1", "marketing/team");

    // The path was supplied, so no getEntry round-trip; the list GET uses it.
    expect(getEntry).not.toHaveBeenCalled();
    const [suffix] = fetch.mock.calls[0];
    expect(suffix).toContain(encodeURIComponent("marketing/team"));
    expect(suffix).toContain("type=task");
  });

  it("falls back to resolving the path via getEntry when none is given", async () => {
    const { fs, getEntry } = fakeFs([]);
    const service = new ChannelTasksService(fs);

    await service.list("chan-1");

    expect(getEntry).toHaveBeenCalledTimes(1);
  });

  it("maps rows to records sorted by createdAt descending, dropping ref-less rows", async () => {
    const { fs } = fakeFs([
      taskRow("a", "task-a", "2026-01-01T00:00:00Z"),
      taskRow("c", "task-c", "2026-01-03T00:00:00Z"),
      { id: "no-ref", path: "Channels/chan-1/x", type: "task" } as FsEntryBase,
      taskRow("b", "task-b", "2026-01-02T00:00:00Z"),
    ]);
    const service = new ChannelTasksService(fs);

    const result = await service.list("chan-1", "Channels/chan-1");

    expect(result.map((r) => r.taskId)).toEqual(["task-c", "task-b", "task-a"]);
  });
});
