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
  createDesktopFileSystemShortcut: vi.fn(),
  deleteDesktopFileSystemShortcut: vi.fn(),
}));
vi.mock("@posthog/ui/features/auth/authClient", () => ({
  useOptionalAuthenticatedClient: () => mockClient,
}));
vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const holder = vi.hoisted(() => ({
  services: new Map<symbol, unknown>(),
}));
vi.mock("@posthog/di/react", () => ({
  useService: (token: symbol) => holder.services.get(token),
}));

import { useChannelStars, useChannelStarToggle } from "./useChannelStars";
import type { Channel } from "./useChannels";

function shortcut(
  id: string,
  type: string,
  ref: string | null,
): Schemas.FileSystemShortcut {
  return {
    id,
    path: ref?.replace(/^\/+/, "") ?? "x",
    type,
    ref,
    created_at: "2026-01-01T00:00:00Z",
  } as unknown as Schemas.FileSystemShortcut;
}

function channel(id: string, name: string, path: string): Channel {
  return { id, name, path };
}

let registry: EntityRegistry;
let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function seedStars(rows: Schemas.FileSystemShortcut[]) {
  registry
    .getPool(channelStarsEntity.name)
    .applyUpserts(rows as never[], { persist: false });
}

describe("useChannelStars (pool-backed)", () => {
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

  it("maps folder shortcuts by ref, ignoring other types and ref-less rows", () => {
    seedStars([
      shortcut("s1", "folder", "/alpha"),
      shortcut("s2", "insight", "abc"), // not a channel
      shortcut("s3", "folder", null), // no ref to link
    ]);

    const { result } = renderHook(() => useChannelStars(), { wrapper });
    expect(result.current.starredRefToShortcutId.get("/alpha")).toBe("s1");
    expect(result.current.starredRefToShortcutId.size).toBe(1);
  });

  it("stars an unstarred channel via its raw path, updating the pool immediately", async () => {
    mockClient.createDesktopFileSystemShortcut.mockResolvedValue(
      shortcut("s-new", "folder", "/alpha"),
    );

    const { result } = renderHook(
      () => ({
        stars: useChannelStars(),
        toggle: useChannelStarToggle(channel("c1", "alpha", "/alpha")),
      }),
      { wrapper },
    );
    expect(result.current.toggle.isStarred).toBe(false);

    await act(async () => {
      result.current.toggle.toggleStar();
      await Promise.resolve();
    });

    expect(mockClient.createDesktopFileSystemShortcut).toHaveBeenCalledWith({
      path: "alpha",
      type: "folder",
      ref: "/alpha",
    });
    expect(result.current.stars.starredRefToShortcutId.get("/alpha")).toBe(
      "s-new",
    );
    expect(result.current.toggle.isStarred).toBe(true);
  });

  it("unstars a starred channel by deleting its shortcut id", async () => {
    seedStars([shortcut("s1", "folder", "/alpha")]);
    mockClient.deleteDesktopFileSystemShortcut.mockResolvedValue(undefined);

    const { result } = renderHook(
      () => ({
        stars: useChannelStars(),
        toggle: useChannelStarToggle(channel("c1", "alpha", "/alpha")),
      }),
      { wrapper },
    );
    expect(result.current.toggle.isStarred).toBe(true);

    await act(async () => {
      result.current.toggle.toggleStar();
      await Promise.resolve();
    });

    expect(mockClient.deleteDesktopFileSystemShortcut).toHaveBeenCalledWith(
      "s1",
    );
    expect(result.current.toggle.isStarred).toBe(false);
  });
});
