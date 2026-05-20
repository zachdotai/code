import { beforeEach, describe, expect, it } from "vitest";
import { usePlanAgentActivityStore } from "./planAgentActivityStore";

const KEY_A = "plan.md::Block A::0";
const KEY_B = "plan.md::Block B::0";

describe("planAgentActivityStore", () => {
  beforeEach(() => {
    usePlanAgentActivityStore.setState({ queue: [] });
  });

  it("starts empty — getStatus returns null for unknown keys", () => {
    expect(usePlanAgentActivityStore.getState().getStatus(KEY_A)).toBeNull();
  });

  it("enqueue makes the first thread `active`", () => {
    usePlanAgentActivityStore.getState().enqueue(KEY_A);
    expect(usePlanAgentActivityStore.getState().getStatus(KEY_A)).toBe(
      "active",
    );
  });

  it("a second enqueue becomes `queued` while the first is still active", () => {
    usePlanAgentActivityStore.getState().enqueue(KEY_A);
    usePlanAgentActivityStore.getState().enqueue(KEY_B);
    const { getStatus } = usePlanAgentActivityStore.getState();
    expect(getStatus(KEY_A)).toBe("active");
    expect(getStatus(KEY_B)).toBe("queued");
  });

  it("enqueue is idempotent — duplicate keys don't shift status", () => {
    usePlanAgentActivityStore.getState().enqueue(KEY_A);
    usePlanAgentActivityStore.getState().enqueue(KEY_A);
    usePlanAgentActivityStore.getState().enqueue(KEY_A);
    expect(usePlanAgentActivityStore.getState().queue).toEqual([KEY_A]);
  });

  it("dequeue removes the thread and promotes the next one to active", () => {
    usePlanAgentActivityStore.getState().enqueue(KEY_A);
    usePlanAgentActivityStore.getState().enqueue(KEY_B);
    usePlanAgentActivityStore.getState().dequeue(KEY_A);
    const { getStatus } = usePlanAgentActivityStore.getState();
    expect(getStatus(KEY_A)).toBeNull();
    expect(getStatus(KEY_B)).toBe("active");
  });

  it("dequeue from the middle of the queue compacts cleanly", () => {
    usePlanAgentActivityStore.getState().enqueue(KEY_A);
    usePlanAgentActivityStore.getState().enqueue(KEY_B);
    usePlanAgentActivityStore.getState().enqueue("plan.md::C::0");
    usePlanAgentActivityStore.getState().dequeue(KEY_B);
    expect(usePlanAgentActivityStore.getState().queue).toEqual([
      KEY_A,
      "plan.md::C::0",
    ]);
  });

  it("dequeue is a no-op for unknown keys", () => {
    usePlanAgentActivityStore.getState().enqueue(KEY_A);
    usePlanAgentActivityStore.getState().dequeue("plan.md::nope::0");
    expect(usePlanAgentActivityStore.getState().queue).toEqual([KEY_A]);
  });

  it("buildThreadKey produces a stable key from (filePath, blockText, occurrence)", async () => {
    const { buildThreadKey } = await import("./planAgentActivityStore");
    const k1 = buildThreadKey({
      filePath: "/x/plan.md",
      blockText: "## Step 1",
      occurrence: 0,
    });
    const k2 = buildThreadKey({
      filePath: "/x/plan.md",
      blockText: "## Step 1",
      occurrence: 0,
    });
    expect(k1).toBe(k2);
    // Different occurrence under the same heading is a different thread.
    const k3 = buildThreadKey({
      filePath: "/x/plan.md",
      blockText: "## Step 1",
      occurrence: 1,
    });
    expect(k3).not.toBe(k1);
  });
});
