import type { NestMessage } from "@main/services/rts/schemas";
import { beforeEach, describe, expect, it } from "vitest";
import { selectNestMessages, useNestChatStore } from "./nestChatStore";

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

describe("nestChatStore", () => {
  beforeEach(() => {
    useNestChatStore.setState({
      messagesByNestId: {},
      loadingByNestId: {},
    });
  });

  it("sets messages for a nest", () => {
    useNestChatStore.getState().setMessages("nest-1", [message]);

    expect(selectNestMessages("nest-1")(useNestChatStore.getState())).toEqual([
      message,
    ]);
  });

  it("sets loading state for a nest", () => {
    useNestChatStore.getState().setLoading("nest-1", true);

    expect(useNestChatStore.getState().loadingByNestId["nest-1"]).toBe(true);
  });

  it("returns an empty list when no nest is selected", () => {
    expect(selectNestMessages(null)(useNestChatStore.getState())).toEqual([]);
  });
});
