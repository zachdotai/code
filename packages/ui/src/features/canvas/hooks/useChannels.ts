import type { Schemas } from "@posthog/api-client";
import { CHANNELS_COLLECTION } from "@posthog/core/canvas/channelsSync";
import type { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import { ENTITY_REGISTRY } from "@posthog/core/local-store/identifiers";
import type { SyncedEntity } from "@posthog/core/local-store/schemas";
import type { ApplyPipeline } from "@posthog/core/local-store/sync/applyPipeline";
import {
  APPLY_PIPELINE,
  SYNC_ENGINE,
} from "@posthog/core/local-store/sync/identifiers";
import type { SyncEngine } from "@posthog/core/local-store/sync/syncEngine";
import { useService } from "@posthog/di/react";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useMutation } from "@tanstack/react-query";
import { useMemo } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

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

function useChannelsPool() {
  const registry = useService<EntityRegistry>(ENTITY_REGISTRY);
  return useMemo(
    () => registry.getPool<SyncedEntity>(CHANNELS_COLLECTION),
    [registry],
  );
}

/**
 * List the project's channels (top-level desktop file-system folders) —
 * local-first: rendered from the synced pool, kept fresh by the channels
 * delta source instead of a per-hook poll.
 */
export function useChannels(_options?: { enabled?: boolean }): {
  channels: Channel[];
  isLoading: boolean;
} {
  const pool = useChannelsPool();
  const channels = useStore(
    pool.store,
    useShallow((state) =>
      state.ids
        .map((id) => state.entities[id] as unknown as Schemas.FileSystem)
        .filter((fs) => fs && fs.type === "folder")
        .map(toChannel)
        .sort((a, b) => a.name.localeCompare(b.name)),
    ),
  );
  const hydrated = useStore(pool.store, (state) => state.hydrated);
  return { channels, isLoading: !hydrated };
}

/**
 * Create/delete/rename channels. Server responses acknowledge straight into
 * the pool so the sidebar updates the instant the request resolves; a poke
 * reconciles anything derived.
 */
export function useChannelMutations() {
  const client = useOptionalAuthenticatedClient();
  const engine = useService<SyncEngine>(SYNC_ENGINE);
  const applyPipeline = useService<ApplyPipeline>(APPLY_PIPELINE);
  const pool = useChannelsPool();

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!client) throw new Error("Not authenticated");
      return client.createDesktopFileSystemChannel(name);
    },
    onSuccess: (newFs) => {
      applyPipeline.applyAcknowledged(
        CHANNELS_COLLECTION,
        newFs as unknown as SyncedEntity,
      );
      engine.poke(CHANNELS_COLLECTION);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!client) throw new Error("Not authenticated");
      await client.deleteDesktopFileSystem(id);
      return id;
    },
    onSuccess: (id) => {
      pool.applyDeletes([id]);
      engine.poke(CHANNELS_COLLECTION);
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      if (!client) throw new Error("Not authenticated");
      return client.renameDesktopFileSystemChannel(id, name);
    },
    onSuccess: (renamed) => {
      applyPipeline.applyAcknowledged(
        CHANNELS_COLLECTION,
        renamed as unknown as SyncedEntity,
      );
      engine.poke(CHANNELS_COLLECTION);
    },
  });

  return {
    createChannel: (name: string) =>
      createMutation.mutateAsync(name).then(toChannel),
    deleteChannel: (id: string) => deleteMutation.mutateAsync(id),
    renameChannel: (id: string, name: string) =>
      renameMutation.mutateAsync({ id, name }).then(toChannel),
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isRenaming: renameMutation.isPending,
  };
}
