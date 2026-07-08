import type { Schemas } from "@posthog/api-client";
import type { TaskChannel } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import {
  normalizeChannelName,
  PERSONAL_CHANNEL_NAME,
  TASK_CHANNELS_QUERY_KEY,
} from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

const CHANNELS_POLL_INTERVAL_MS = 30_000;
const CHANNELS_QUERY_KEY = ["canvas-channels"] as const;

/** A Home-space channel: a top-level folder on the desktop file system. */
export interface Channel {
  id: string;
  /** Display name — the channel's single-segment path. */
  name: string;
  /**
   * Raw file-system path of the folder. Used as the `ref` when starring the
   * channel, so the desktop shortcut links back to this exact folder.
   */
  path: string;
  /**
   * File-system id of the channel's home canvas, if one has been created.
   * Stored on the folder row's `meta`; used to open the home canvas when the
   * channel name is clicked. Absent on channels made before home canvases
   * existed (those are backfilled lazily on first open).
   */
  homeCanvasId?: string;
}

function toChannel(fs: Schemas.FileSystem): Channel {
  // The generated OpenAPI type declares `meta` as null, but the API returns our
  // free-form blob at runtime; read homeCanvasId past the type.
  const meta = fs.meta as { homeCanvasId?: string } | null | undefined;
  // Top-level channels have a single-segment path; strip any leading slash.
  return {
    id: fs.id,
    name: fs.path.replace(/^\/+/, ""),
    path: fs.path,
    homeCanvasId: meta?.homeCanvasId,
  };
}

/** List the project's channels (top-level desktop file-system folders). */
export function useChannels(options?: { enabled?: boolean }): {
  channels: Channel[];
  isLoading: boolean;
} {
  const query = useAuthenticatedQuery<Schemas.FileSystem[]>(
    CHANNELS_QUERY_KEY,
    (client) => client.getDesktopFileSystemChannels(),
    {
      enabled: options?.enabled ?? true,
      refetchInterval: CHANNELS_POLL_INTERVAL_MS,
    },
  );
  // Memoize so the array reference is stable while the underlying data is
  // unchanged — callers depend on `channels` in their own memos/effects.
  const channels = useMemo(
    () =>
      (query.data ?? [])
        .filter((fs) => fs.type === "folder")
        .map(toChannel)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [query.data],
  );
  return { channels, isLoading: query.isLoading };
}

/**
 * Create/delete channels. Both invalidate the shared query key so the list
 * refetches immediately rather than waiting on the poll.
 */
export function useChannelMutations() {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: CHANNELS_QUERY_KEY });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!client) throw new Error("Not authenticated");
      return client.createDesktopFileSystemChannel(name);
    },
    onSuccess: (newFs) => {
      // Insert the created channel into the cache immediately so the sidebar
      // updates the instant the POST resolves, rather than waiting on the
      // paginated refetch that `invalidate` triggers.
      queryClient.setQueryData<Schemas.FileSystem[]>(
        CHANNELS_QUERY_KEY,
        (old) => {
          if (!old) return [newFs];
          if (old.some((fs) => fs.id === newFs.id)) return old;
          return [...old, newFs];
        },
      );
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      if (!client) throw new Error("Not authenticated");
      // The task feed lives on a separate backend channel. Deleting only the
      // folder would leave that channel live but unreachable, with its tasks
      // orphaned under it. Instead, soft-delete the tasks and the backend
      // channel first (both are soft deletes server-side, so nothing is
      // lost), then remove the folder. Backend first: if it fails, nothing
      // local has changed.
      const normalized = normalizeChannelName(name);
      if (normalized !== PERSONAL_CHANNEL_NAME) {
        const backendChannels = await client.getTaskChannels();
        const backendChannel = backendChannels.find(
          (c) => c.channel_type === "public" && c.name === normalized,
        );
        if (backendChannel) {
          // getTasks caps at 500 and does not paginate, so a channel with more
          // than 500 tasks soft-deletes only the first page here. The channel
          // itself is still soft-deleted below, so any stragglers stay attached
          // to it and remain recoverable — nothing is lost, just left behind.
          const tasks = await client.getTasks({ channel: backendChannel.id });
          // Best-effort per task — one failed soft delete shouldn't strand
          // the rest or block the channel delete (the failed task stays
          // attached to the soft-deleted channel, still recoverable).
          await Promise.allSettled(
            tasks.map((task) => client.deleteTask(task.id)),
          );
          await client.deleteTaskChannel(backendChannel.id);
        }
      }
      return client.deleteDesktopFileSystem(id);
    },
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: TASK_CHANNELS_QUERY_KEY });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({
      id,
      name,
      oldName,
    }: {
      id: string;
      name: string;
      oldName: string;
    }) => {
      if (!client) throw new Error("Not authenticated");
      // The task feed lives on a separate backend channel that is resolved by
      // name, so it must move in lockstep with the folder — otherwise the feed
      // would resolve to a brand-new empty channel and the existing tasks and
      // messages would be orphaned under the old name. Rename the data-bearing
      // backend channel first: if that fails, nothing has changed.
      const from = normalizeChannelName(oldName);
      const to = normalizeChannelName(name);
      let backendChannel: TaskChannel | undefined;
      if (from !== to && from !== PERSONAL_CHANNEL_NAME) {
        const backendChannels = await client.getTaskChannels();
        backendChannel = backendChannels.find(
          (c) => c.channel_type === "public" && c.name === from,
        );
        if (backendChannel) {
          await client.renameTaskChannel(backendChannel.id, to);
        }
      }
      try {
        return await client.renameDesktopFileSystemChannel(id, name);
      } catch (error) {
        // The folder rename failed after the backend channel moved — put the
        // backend name back so the two sides stay in sync.
        if (backendChannel) {
          await client
            .renameTaskChannel(backendChannel.id, from)
            .catch(() => undefined);
        }
        throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: TASK_CHANNELS_QUERY_KEY });
    },
  });

  return {
    createChannel: (name: string) =>
      createMutation.mutateAsync(name).then(toChannel),
    deleteChannel: (id: string, name: string) =>
      deleteMutation.mutateAsync({ id, name }),
    renameChannel: (id: string, name: string, oldName: string) =>
      renameMutation.mutateAsync({ id, name, oldName }).then(toChannel),
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isRenaming: renameMutation.isPending,
  };
}
