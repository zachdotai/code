import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import type { TaskChannel } from "@posthog/shared/domain-types";
import { describe, expect, it, vi } from "vitest";
import { resolveBackendChannelId } from "./useFileTaskToChannelFeed";

function channel(overrides: Partial<TaskChannel>): TaskChannel {
  return {
    id: "c-1",
    name: "eng",
    channel_type: "public",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("resolveBackendChannelId", () => {
  it("resolves a public channel by its normalized name", async () => {
    const resolveTaskChannel = vi
      .fn()
      .mockResolvedValue(channel({ id: "backend-42", name: "growth-team" }));
    const client = {
      getTaskChannels: vi.fn(),
      resolveTaskChannel,
    } as unknown as Pick<
      PostHogAPIClient,
      "getTaskChannels" | "resolveTaskChannel"
    >;

    const id = await resolveBackendChannelId(client, "Growth Team");

    expect(id).toBe("backend-42");
    // Name is normalized to the backend's directory-safe form before resolving.
    expect(resolveTaskChannel).toHaveBeenCalledWith("growth-team");
  });

  it("maps the 'me' folder onto the personal channel instead of creating a public one", async () => {
    const getTaskChannels = vi
      .fn()
      .mockResolvedValue([
        channel({ id: "pub", channel_type: "public", name: "eng" }),
        channel({ id: "personal-7", channel_type: "personal", name: "me" }),
      ]);
    const resolveTaskChannel = vi.fn();
    const client = {
      getTaskChannels,
      resolveTaskChannel,
    } as unknown as Pick<
      PostHogAPIClient,
      "getTaskChannels" | "resolveTaskChannel"
    >;

    const id = await resolveBackendChannelId(client, "me");

    expect(id).toBe("personal-7");
    expect(resolveTaskChannel).not.toHaveBeenCalled();
  });

  it("falls back to resolve-or-create when no personal channel is present", async () => {
    const getTaskChannels = vi.fn().mockResolvedValue([]);
    const resolveTaskChannel = vi
      .fn()
      .mockResolvedValue(channel({ id: "created", name: "me" }));
    const client = {
      getTaskChannels,
      resolveTaskChannel,
    } as unknown as Pick<
      PostHogAPIClient,
      "getTaskChannels" | "resolveTaskChannel"
    >;

    const id = await resolveBackendChannelId(client, "me");

    expect(id).toBe("created");
    expect(resolveTaskChannel).toHaveBeenCalledWith("me");
  });
});
