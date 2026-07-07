import type { AgentSession, QueuedMessage } from "@posthog/shared";
import { afterEach, describe, expect, it } from "vitest";
import { sessionStore, sessionStoreSetters } from "./sessionStore";

const RUN = "run-queue";
const TASK = "task-queue";

function seedQueue(messages: QueuedMessage[]) {
  sessionStoreSetters.setSession({
    taskRunId: RUN,
    taskId: TASK,
    events: [],
    messageQueue: messages,
    pendingPermissions: new Map(),
    status: "connected",
  } as unknown as AgentSession);
}

function queue(): QueuedMessage[] {
  return sessionStore.getState().sessions[RUN].messageQueue;
}

function msg(id: string, content: string): QueuedMessage {
  return { id, content, queuedAt: 1 };
}

afterEach(() => sessionStoreSetters.removeSession(RUN));

describe("moveQueuedMessage", () => {
  it("moves a message to a later position, preserving the others' order", () => {
    seedQueue([msg("a", "A"), msg("b", "B"), msg("c", "C")]);

    sessionStoreSetters.moveQueuedMessage(TASK, 0, 2);

    expect(queue().map((m) => m.id)).toEqual(["b", "c", "a"]);
  });

  it("moves a message to an earlier position", () => {
    seedQueue([msg("a", "A"), msg("b", "B"), msg("c", "C")]);

    sessionStoreSetters.moveQueuedMessage(TASK, 2, 0);

    expect(queue().map((m) => m.id)).toEqual(["c", "a", "b"]);
  });

  it.each([
    ["same index", 1, 1],
    ["from out of range", 5, 0],
    ["to out of range", 0, 9],
    ["negative index", -1, 0],
  ])("is a no-op for %s", (_label, from, to) => {
    seedQueue([msg("a", "A"), msg("b", "B"), msg("c", "C")]);

    sessionStoreSetters.moveQueuedMessage(TASK, from, to);

    expect(queue().map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});

describe("updateQueuedMessage", () => {
  it("replaces content and rawPrompt in place, keeping id and position", () => {
    seedQueue([msg("a", "A"), msg("b", "B")]);

    sessionStoreSetters.updateQueuedMessage(TASK, "a", {
      content: "edited A",
      rawPrompt: "edited A raw",
    });

    expect(queue().map((m) => m.id)).toEqual(["a", "b"]);
    expect(queue()[0].content).toBe("edited A");
    expect(queue()[0].rawPrompt).toBe("edited A raw");
    expect(queue()[1].content).toBe("B");
  });

  it("clears a stale rawPrompt when the patch omits it (local edit)", () => {
    seedQueue([{ id: "a", content: "A", rawPrompt: "old raw", queuedAt: 1 }]);

    sessionStoreSetters.updateQueuedMessage(TASK, "a", { content: "edited" });

    expect(queue()[0].content).toBe("edited");
    expect(queue()[0].rawPrompt).toBeUndefined();
  });

  it("is a no-op when the target id is not in the queue", () => {
    seedQueue([msg("a", "A")]);

    sessionStoreSetters.updateQueuedMessage(TASK, "missing", {
      content: "edited",
    });

    expect(queue()[0].content).toBe("A");
  });
});
