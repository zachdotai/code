import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListNestChat = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());

vi.mock("../hostClient", () => ({
  hostClient: () => ({
    rts: {
      nestChat: {
        list: {
          query: mockListNestChat,
        },
      },
    },
  }),
}));

vi.mock("@posthog/ui/shell/logger", () => ({
  logger: {
    scope: () => ({
      error: mockLogError,
    }),
  },
}));

import type { NestMessage } from "@posthog/host-router/rts-schemas";
import { useNestChatStore } from "../stores/nestChatStore";
import { loadNestChatMessages } from "./nestChatService";

const message = {
  id: "message-1",
  nestId: "nest-1",
  kind: "audit",
  visibility: "summary",
  sourceTaskId: null,
  body: "Nest created",
  payloadJson: null,
  createdAt: "2026-05-13T00:00:00.000Z",
} satisfies NestMessage;

describe("nestChatService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNestChatStore.setState({
      messagesByNestId: {},
      loadingByNestId: {},
    });
  });

  it("loads messages through the tRPC boundary", async () => {
    mockListNestChat.mockResolvedValue([message]);

    await loadNestChatMessages("nest-1");

    expect(mockListNestChat).toHaveBeenCalledWith({ nestId: "nest-1" });
    expect(useNestChatStore.getState().messagesByNestId["nest-1"]).toEqual([
      message,
    ]);
    expect(useNestChatStore.getState().loadingByNestId["nest-1"]).toBe(false);
  });

  it("clears loading state when the tRPC call fails", async () => {
    mockListNestChat.mockRejectedValue(new Error("boom"));

    await loadNestChatMessages("nest-1");

    expect(useNestChatStore.getState().messagesByNestId["nest-1"]).toBe(
      undefined,
    );
    expect(useNestChatStore.getState().loadingByNestId["nest-1"]).toBe(false);
    expect(mockLogError).toHaveBeenCalled();
  });
});
