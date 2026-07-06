import type { Schemas } from "@posthog/api-client";
import {
  CHANNEL_STARS_COLLECTION,
  CHANNELS_COLLECTION,
} from "@posthog/core/canvas/channelsSync";
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
import type { Channel } from "@posthog/ui/features/canvas/hooks/useChannels";
import { toast } from "@posthog/ui/primitives/toast";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

// Channels are folders, so their stars are folder-typed shortcuts. Anything
// else on the desktop surface (a starred insight, say) is ignored here.
const FOLDER_SHORTCUT_TYPE = "folder";

function useStarsPool() {
  const registry = useService<EntityRegistry>(ENTITY_REGISTRY);
  return useMemo(
    () => registry.getPool<SyncedEntity>(CHANNEL_STARS_COLLECTION),
    [registry],
  );
}

/**
 * The current user's starred channels, persisted in the PostHog backend as
 * per-user desktop file-system shortcuts — read from the local-first pool.
 * Returns a map from a channel's raw path (the shortcut `ref`) to the
 * shortcut id, so callers can both check whether a channel is starred and
 * delete the right shortcut when unstarring.
 */
export function useChannelStars(_options?: { enabled?: boolean }): {
  starredRefToShortcutId: Map<string, string>;
  isLoading: boolean;
} {
  const pool = useStarsPool();
  const shortcuts = useStore(
    pool.store,
    useShallow((state) =>
      state.ids
        .map(
          (id) => state.entities[id] as unknown as Schemas.FileSystemShortcut,
        )
        .filter((s) => s && s.type === FOLDER_SHORTCUT_TYPE && s.ref),
    ),
  );
  const hydrated = useStore(pool.store, (state) => state.hydrated);

  const starredRefToShortcutId = useMemo(() => {
    const map = new Map<string, string>();
    for (const shortcut of shortcuts) {
      if (shortcut.ref) map.set(shortcut.ref, shortcut.id);
    }
    return map;
  }, [shortcuts]);

  return { starredRefToShortcutId, isLoading: !hydrated };
}

/**
 * Star/unstar a channel by creating or deleting its desktop shortcut. Server
 * responses acknowledge straight into the pool so the sidebar re-sorts the
 * instant the request resolves.
 */
export function useChannelStarMutations() {
  const client = useOptionalAuthenticatedClient();
  const engine = useService<SyncEngine>(SYNC_ENGINE);
  const applyPipeline = useService<ApplyPipeline>(APPLY_PIPELINE);
  const pool = useStarsPool();

  const starMutation = useMutation({
    mutationFn: async (channel: Channel) => {
      if (!client) throw new Error("Not authenticated");
      return client.createDesktopFileSystemShortcut({
        path: channel.name,
        type: FOLDER_SHORTCUT_TYPE,
        ref: channel.path,
      });
    },
    onSuccess: (created) => {
      applyPipeline.applyAcknowledged(
        CHANNEL_STARS_COLLECTION,
        created as unknown as SyncedEntity,
      );
      engine.poke(CHANNELS_COLLECTION);
    },
  });

  const unstarMutation = useMutation({
    mutationFn: async (shortcutId: string) => {
      if (!client) throw new Error("Not authenticated");
      await client.deleteDesktopFileSystemShortcut(shortcutId);
      return shortcutId;
    },
    onSuccess: (shortcutId) => {
      pool.applyDeletes([shortcutId]);
      engine.poke(CHANNELS_COLLECTION);
    },
  });

  return {
    star: (channel: Channel) => starMutation.mutateAsync(channel),
    unstar: (shortcutId: string) => unstarMutation.mutateAsync(shortcutId),
    isStarring: starMutation.isPending,
    isUnstarring: unstarMutation.isPending,
  };
}

/**
 * Per-channel star state plus the actions a channel row needs. Wraps the
 * shared pool read and mutations so the row components stay declarative.
 */
export function useChannelStarToggle(channel: Channel): {
  isStarred: boolean;
  toggleStar: () => void;
  /** Remove the star if present — used when the channel itself is deleted so
   *  a same-named channel created later doesn't inherit a stale star. */
  removeStar: () => void;
} {
  const { starredRefToShortcutId } = useChannelStars();
  const { star, unstar } = useChannelStarMutations();
  const shortcutId = starredRefToShortcutId.get(channel.path);
  const isStarred = shortcutId !== undefined;

  const toggleStar = useCallback(() => {
    const run = shortcutId ? unstar(shortcutId) : star(channel);
    run.catch((error: unknown) => {
      toast.error(
        isStarred ? "Couldn't unstar channel" : "Couldn't star channel",
        {
          description: error instanceof Error ? error.message : String(error),
        },
      );
    });
  }, [channel, shortcutId, isStarred, star, unstar]);

  const removeStar = useCallback(() => {
    if (shortcutId) {
      void unstar(shortcutId);
    }
  }, [shortcutId, unstar]);

  return { isStarred, toggleStar, removeStar };
}
