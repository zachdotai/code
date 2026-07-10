import { describe, expect, it, vi } from "vitest";
import { ChannelsService } from "./channels";
import type { DesktopFsClient, FsEntryBase } from "./desktopFsClient";

// A minimal Response-like object exposing only what ChannelsService reads.
function res(body: unknown, init?: { status?: number }): Response {
  const status = init?.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

type Row = FsEntryBase;

/**
 * Fake DesktopFsClient. `channel` is the folder getEntry resolves to (null =
 * missing). `parentRows` answers the parent-scoped task list; `refRows` answers
 * the ref lookup. POST/move/DELETE are recorded so tests can assert on writes.
 */
function fakeFs(opts: {
  channel?: Row | null;
  parentRows?: Row[];
  refRows?: Row[];
  deleteStatus?: number;
}) {
  const posts: Array<Record<string, unknown>> = [];
  const moves: Array<{ id: string; newPath: string }> = [];
  const deletes: string[] = [];
  let created = 0;

  const fetch = vi.fn(
    async (suffix: string, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") {
        deletes.push(suffix);
        return res(null, { status: opts.deleteStatus ?? 204 });
      }
      if (method === "POST" && suffix === "") {
        const body = JSON.parse(init?.body as string) as Record<
          string,
          unknown
        >;
        posts.push(body);
        created += 1;
        return res({
          id: `fs-${created}`,
          path: body.path,
          ref: body.ref,
          created_at: "2024-01-01T00:00:00Z",
        });
      }
      if (method === "POST" && suffix.endsWith("/move/")) {
        const body = JSON.parse(init?.body as string) as { new_path: string };
        const id = decodeURIComponent(suffix.replace("/move/", ""));
        moves.push({ id, newPath: body.new_path });
        return res({ id, path: body.new_path, ref: "task-1" });
      }
      if (suffix.startsWith("?type=task&ref=")) {
        return res({ results: opts.refRows ?? [] });
      }
      // parent-scoped task list
      return res({ results: opts.parentRows ?? [] });
    },
  );

  const getEntry = vi.fn(async () =>
    opts.channel === undefined
      ? { id: "chan-1", path: "team-x" }
      : opts.channel,
  );

  const fs = { fetch, getEntry } as unknown as DesktopFsClient;
  return { fs, fetch, posts, moves, deletes };
}

describe("ChannelsService.listTasks", () => {
  it("queries the channel folder scoped to task rows", async () => {
    const { fs, fetch } = fakeFs({ parentRows: [] });
    await new ChannelsService(fs).listTasks("chan-1");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [suffix] = fetch.mock.calls[0];
    expect(suffix).toContain(`parent=${encodeURIComponent("team-x")}`);
    expect(suffix).toContain("type=task");
  });

  it("drops ref-less rows and sorts by createdAt descending", async () => {
    const { fs } = fakeFs({
      parentRows: [
        {
          id: "a",
          path: "team-x/Old",
          ref: "task-a",
          created_at: "2024-01-01T00:00:00Z",
        },
        { id: "folder", path: "team-x/sub" }, // no ref -> dropped
        {
          id: "b",
          path: "team-x/New",
          ref: "task-b",
          created_at: "2024-03-01T00:00:00Z",
        },
      ],
    });

    const out = await new ChannelsService(fs).listTasks("chan-1");

    expect(out.map((r) => r.id)).toEqual(["b", "a"]);
    expect(out[0]).toMatchObject({ channelId: "chan-1", taskId: "task-b" });
  });

  it("throws when the channel folder does not exist", async () => {
    const { fs } = fakeFs({ channel: null });
    await expect(new ChannelsService(fs).listTasks("missing")).rejects.toThrow(
      "Channel not found",
    );
  });
});

describe("ChannelsService.fileTask", () => {
  it("creates a home row and a channel row when the task has none", async () => {
    const { fs, posts } = fakeFs({ refRows: [] });

    const record = await new ChannelsService(fs).fileTask({
      channelId: "chan-1",
      taskId: "task-1",
      taskTitle: "My Task",
    });

    // Home row first (invariant: home must exist before channel rows), then the
    // channel filing.
    expect(posts).toHaveLength(2);
    expect(posts[0].path).toBe("Unfiled/Tasks/My Task");
    expect(posts[1].path).toBe("team-x/My Task");
    expect(record).toMatchObject({ channelId: "chan-1", taskId: "task-1" });
  });

  it("is a no-op returning the existing row when already filed at the target", async () => {
    const { fs, posts, moves } = fakeFs({
      refRows: [
        { id: "home", path: "Unfiled/Tasks/My Task", ref: "task-1" },
        { id: "c1", path: "team-x/My Task", ref: "task-1" },
      ],
    });

    const record = await new ChannelsService(fs).fileTask({
      channelId: "chan-1",
      taskId: "task-1",
      taskTitle: "My Task",
    });

    expect(posts).toHaveLength(0);
    expect(moves).toHaveLength(0);
    expect(record.id).toBe("c1");
  });

  it("moves an existing channel row rather than duplicating it", async () => {
    const { fs, posts, moves } = fakeFs({
      refRows: [
        { id: "home", path: "Unfiled/Tasks/My Task", ref: "task-1" },
        { id: "c1", path: "other/My Task", ref: "task-1" },
      ],
    });

    await new ChannelsService(fs).fileTask({
      channelId: "chan-1",
      taskId: "task-1",
      taskTitle: "My Task",
    });

    expect(posts).toHaveLength(0);
    expect(moves).toEqual([{ id: "c1", newPath: "team-x/My Task" }]);
  });
});

describe("ChannelsService.unfileTask", () => {
  it("tolerates a 404", async () => {
    const { fs, deletes } = fakeFs({ deleteStatus: 404 });
    await expect(
      new ChannelsService(fs).unfileTask("row-1"),
    ).resolves.toBeUndefined();
    expect(deletes).toHaveLength(1);
  });

  it("throws on a non-404 error", async () => {
    const { fs } = fakeFs({ deleteStatus: 500 });
    await expect(new ChannelsService(fs).unfileTask("row-1")).rejects.toThrow(
      /Failed to unfile task/,
    );
  });
});
