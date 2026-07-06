import type { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import {
  defineEntity,
  type SyncedEntity,
} from "@posthog/core/local-store/schemas";
import type {
  DeltaSource,
  PulledWindow,
} from "@posthog/core/local-store/sync/deltaSource";
import type { CloudClientProvider } from "@posthog/core/local-store/sync/identifiers";
import type { SyncEngine } from "@posthog/core/local-store/sync/syncEngine";
import { z } from "zod";

export const CHANNELS_COLLECTION = "channels";
export const CHANNEL_STARS_COLLECTION = "channel_stars";
export const TASK_CHANNELS_COLLECTION = "task_channels";

const CHANNELS_PULL_INTERVAL_MS = 30_000;

const idOnlySchema = z.looseObject({ id: z.string() });

export const channelsEntity = defineEntity<SyncedEntity>({
  name: CHANNELS_COLLECTION,
  version: 1,
  schema: idOnlySchema as unknown as z.ZodType<SyncedEntity>,
  hydration: "eager",
});

export const channelStarsEntity = defineEntity<SyncedEntity>({
  name: CHANNEL_STARS_COLLECTION,
  version: 1,
  schema: idOnlySchema as unknown as z.ZodType<SyncedEntity>,
  hydration: "eager",
});

export const taskChannelsEntity = defineEntity<SyncedEntity>({
  name: TASK_CHANNELS_COLLECTION,
  version: 1,
  schema: idOnlySchema as unknown as z.ZodType<SyncedEntity>,
  hydration: "eager",
});

/**
 * Channel surfaces in one pull: desktop file-system channels (sidebar
 * folders), the user's starred-channel shortcuts, and backend task channels
 * (which the list endpoint lazily provisions #me on). All three are small
 * full-list endpoints, so every window sweeps completely.
 */
export class CanvasChannelsDeltaSource implements DeltaSource<SyncedEntity> {
  readonly collection = CHANNELS_COLLECTION;
  readonly intervalMs = CHANNELS_PULL_INTERVAL_MS;

  constructor(private readonly provider: CloudClientProvider) {}

  async pull(): Promise<PulledWindow<SyncedEntity>[] | null> {
    const client = this.provider.getClient();
    if (!client) return null;

    const [channels, shortcuts, taskChannels] = await Promise.all([
      client.getDesktopFileSystemChannels(),
      client.getDesktopFileSystemShortcuts(),
      client.getTaskChannels(),
    ]);

    const sweepAll = { complete: true, matches: () => true };
    return [
      {
        key: "channels",
        rows: channels as unknown as SyncedEntity[],
        sweep: sweepAll,
      },
      {
        key: "stars",
        collection: CHANNEL_STARS_COLLECTION,
        rows: shortcuts as unknown as SyncedEntity[],
        sweep: sweepAll,
      },
      {
        key: "task-channels",
        collection: TASK_CHANNELS_COLLECTION,
        rows: taskChannels as unknown as SyncedEntity[],
        sweep: sweepAll,
      },
    ];
  }
}

export function registerChannelsSync(
  registry: EntityRegistry,
  engine: SyncEngine,
  provider: CloudClientProvider,
): void {
  registry.register(channelsEntity);
  registry.register(channelStarsEntity);
  registry.register(taskChannelsEntity);
  engine.registerSource(new CanvasChannelsDeltaSource(provider));
}
