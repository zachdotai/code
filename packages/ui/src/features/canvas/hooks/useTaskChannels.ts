import {
  CHANNELS_COLLECTION,
  TASK_CHANNELS_COLLECTION,
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
import type { TaskChannel } from "@posthog/shared/domain-types";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

/** Name reserved for the personal channel; mirrors the backend constant. */
export const PERSONAL_CHANNEL_NAME = "me";

/** Client-side mirror of the backend's channel-name normalization. */
export function normalizeChannelName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 128);
}

/**
 * Backend task channels — the feed/ownership side of a channel (the sidebar's
 * folder "channels" stay on the desktop file system for CONTEXT.md and
 * artifacts). Local-first: read from the synced pool; the channels source's
 * list pull also lazily provisions the requester's #me channel.
 */
export function useTaskChannels(): {
  channels: TaskChannel[];
  personalChannel: TaskChannel | undefined;
  isLoading: boolean;
} {
  const registry = useService<EntityRegistry>(ENTITY_REGISTRY);
  const pool = useMemo(
    () => registry.getPool<SyncedEntity>(TASK_CHANNELS_COLLECTION),
    [registry],
  );
  const channels = useStore(
    pool.store,
    useShallow((state) =>
      state.ids
        .map((id) => state.entities[id] as unknown as TaskChannel)
        .filter(Boolean),
    ),
  );
  const hydrated = useStore(pool.store, (state) => state.hydrated);
  const personalChannel = useMemo(
    () => channels.find((c) => c.channel_type === "personal"),
    [channels],
  );
  return { channels, personalChannel, isLoading: !hydrated };
}

/**
 * Map a folder channel (by display name) onto its backend channel. The "me"
 * folder is the bridge for the personal channel; any other name resolves (or
 * creates) the matching public channel, so feeds keep working for channels
 * created before backend channels existed.
 */
export function useBackendChannel(channelName: string | undefined): {
  channel: TaskChannel | undefined;
  isLoading: boolean;
} {
  const normalized = channelName ? normalizeChannelName(channelName) : "";
  const isPersonal = normalized === PERSONAL_CHANNEL_NAME;
  const { channels, personalChannel, isLoading } = useTaskChannels();
  const client = useOptionalAuthenticatedClient();
  const engine = useService<SyncEngine>(SYNC_ENGINE);
  const applyPipeline = useService<ApplyPipeline>(APPLY_PIPELINE);

  const existing = isPersonal
    ? personalChannel
    : channels.find(
        (c) => c.channel_type === "public" && c.name === normalized,
      );

  // Resolve-or-create is a POST, so it runs as a mutation fired once per
  // missing name. The result acknowledges into the pool, which stops the
  // effect.
  const resolveMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!client) throw new Error("Not authenticated");
      return client.resolveTaskChannel(name);
    },
    onSuccess: (channel) => {
      applyPipeline.applyAcknowledged(
        TASK_CHANNELS_COLLECTION,
        channel as unknown as SyncedEntity,
      );
      engine.poke(CHANNELS_COLLECTION);
    },
  });
  const { mutate: resolve, isPending: isResolving } = resolveMutation;
  useEffect(() => {
    if (normalized && !isPersonal && !isLoading && !existing && !isResolving) {
      resolve(normalized);
    }
  }, [normalized, isPersonal, isLoading, existing, isResolving, resolve]);

  return {
    channel: existing,
    isLoading: isLoading || (!existing && isResolving),
  };
}
