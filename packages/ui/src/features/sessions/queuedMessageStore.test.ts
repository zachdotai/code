import type { QueuedMessage } from "@posthog/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  queuedMessageStoreApi,
  useQueuedMessageStore,
} from "./queuedMessageStore";

function msg(id: string, queuedAt = 1): QueuedMessage {
  return { id, content: `content-${id}`, queuedAt };
}

describe("queuedMessageStore", () => {
  beforeEach(() => {
    useQueuedMessageStore.setState({ byTaskId: {} });
  });

  it("stores and reads a per-task queue", () => {
    queuedMessageStoreApi.set("task-1", [msg("a"), msg("b")]);
    expect(queuedMessageStoreApi.get("task-1").map((m) => m.id)).toEqual([
      "a",
      "b",
    ]);
    expect(queuedMessageStoreApi.get("task-2")).toEqual([]);
  });

  it("drops the key when the queue is emptied", () => {
    queuedMessageStoreApi.set("task-1", [msg("a")]);
    queuedMessageStoreApi.set("task-1", []);
    expect("task-1" in useQueuedMessageStore.getState().byTaskId).toBe(false);
  });

  it("caps a task's queue to the newest messages", () => {
    const many = Array.from({ length: 25 }, (_, i) => msg(`m${i}`, i));
    queuedMessageStoreApi.set("task-1", many);
    const kept = queuedMessageStoreApi.get("task-1");
    expect(kept).toHaveLength(20);
    // Newest (tail) retained.
    expect(kept[0].id).toBe("m5");
    expect(kept.at(-1)?.id).toBe("m24");
  });

  it("clears a single task and clears all", () => {
    queuedMessageStoreApi.set("task-1", [msg("a")]);
    queuedMessageStoreApi.set("task-2", [msg("b")]);

    queuedMessageStoreApi.clear("task-1");
    expect(queuedMessageStoreApi.get("task-1")).toEqual([]);
    expect(queuedMessageStoreApi.get("task-2").map((m) => m.id)).toEqual(["b"]);

    queuedMessageStoreApi.clearAll();
    expect(useQueuedMessageStore.getState().byTaskId).toEqual({});
  });
});
