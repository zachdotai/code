import type { Schemas } from "@posthog/api-client";
import {
  channelStarsEntity,
  channelsEntity,
  taskChannelsEntity,
} from "@posthog/core/canvas/channelsSync";
import { EntityRegistry } from "@posthog/core/local-store/entityRegistry";
import { ENTITY_REGISTRY } from "@posthog/core/local-store/identifiers";
import {
  APPLY_PIPELINE,
  SYNC_ENGINE,
} from "@posthog/core/local-store/sync/identifiers";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => ({
  createDesktopFileSystemChannel: vi.fn(),
  deleteDesktopFileSystem: vi.fn(),
  renameDesktopFileSystemChannel: vi.fn(),
}));
vi.mock("@posthog/ui/features/auth/authClient", () => ({
  useOptionalAuthenticatedClient: () => mockClient,
}));

const holder = vi.hoisted(() => ({
  services: new Map<symbol, unknown>(),
}));
vi.mock("@posthog/di/react", () => ({
  useService: (token: symbol) => holder.services.get(token),
}));

import { useChannelMutations, useChannels } from "./useChannels";

function fsRow(id: string, path: string): Schemas.FileSystem {
  return {
    id,
    path,
    type: "folder",
    meta: null,
    created_at: "2026-01-01T00:00:00Z",
  } as unknown as Schemas.FileSystem;
}

let registry: EntityRegistry;
let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useChannels (pool-backed)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    registry = new EntityRegistry();
    registry.register(channelsEntity);
    registry.register(channelStarsEntity);
    registry.register(taskChannelsEntity);
    const { ApplyPipeline } = await import(
      "@posthog/core/local-store/sync/applyPipeline"
    );
    const noop = () => {};
    const logger = {
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
      scope: () => ({ debug: noop, info: noop, warn: noop, error: noop }),
    };
    const pipeline = new ApplyPipeline(registry, logger as never);
    holder.services.set(ENTITY_REGISTRY, registry);
    holder.services.set(APPLY_PIPELINE, pipeline);
    holder.services.set(SYNC_ENGINE, { poke: vi.fn(), pokeAll: vi.fn() });
  });

  it("lists folder channels from the pool, sorted by name", () => {
    registry
      .getPool(channelsEntity.name)
      .applyUpserts([fsRow("c2", "/beta"), fsRow("c1", "/alpha")] as never[], {
        persist: false,
      });

    const { result } = renderHook(() => useChannels(), { wrapper });
    expect(result.current.channels.map((c) => c.name)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("shows the created channel immediately via pool acknowledgement", async () => {
    mockClient.createDesktopFileSystemChannel.mockResolvedValue(
      fsRow("new-1", "/created"),
    );

    const { result } = renderHook(
      () => ({ list: useChannels(), mutations: useChannelMutations() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutations.createChannel("created");
    });

    expect(result.current.list.channels.map((c) => c.id)).toContain("new-1");
  });

  it("does not duplicate a channel a pull already landed", async () => {
    registry
      .getPool(channelsEntity.name)
      .applyUpserts([fsRow("dup", "/dup")] as never[], { persist: false });
    mockClient.createDesktopFileSystemChannel.mockResolvedValue(
      fsRow("dup", "/dup"),
    );

    const { result } = renderHook(
      () => ({ list: useChannels(), mutations: useChannelMutations() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutations.createChannel("dup");
    });

    expect(
      result.current.list.channels.filter((c) => c.id === "dup"),
    ).toHaveLength(1);
  });

  it("removes a deleted channel from the pool", async () => {
    registry
      .getPool(channelsEntity.name)
      .applyUpserts([fsRow("gone", "/gone")] as never[], { persist: false });
    mockClient.deleteDesktopFileSystem.mockResolvedValue(undefined);

    const { result } = renderHook(
      () => ({ list: useChannels(), mutations: useChannelMutations() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutations.deleteChannel("gone");
    });

    expect(result.current.list.channels).toHaveLength(0);
  });
});
