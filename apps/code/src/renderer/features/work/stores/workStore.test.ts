import { beforeEach, describe, expect, it } from "vitest";
import { useWorkStore } from "./workStore";

describe("workStore", () => {
  beforeEach(() => {
    useWorkStore.setState({ pendingCreateDraft: null, pendingEditDraft: null });
  });

  it("starts with no pending draft", () => {
    expect(useWorkStore.getState().pendingCreateDraft).toBeNull();
    expect(useWorkStore.getState().pendingEditDraft).toBeNull();
  });

  it("setPendingCreateDraft writes the slot", () => {
    useWorkStore
      .getState()
      .setPendingCreateDraft({ name: "Audit", prompt: "Audit my flags" });
    expect(useWorkStore.getState().pendingCreateDraft).toEqual({
      name: "Audit",
      prompt: "Audit my flags",
    });
  });

  it("consumePendingCreateDraft returns the seeded draft and clears it", () => {
    useWorkStore.getState().setPendingCreateDraft({ name: "n", prompt: "p" });
    expect(useWorkStore.getState().consumePendingCreateDraft()).toEqual({
      name: "n",
      prompt: "p",
    });
    expect(useWorkStore.getState().pendingCreateDraft).toBeNull();
    expect(useWorkStore.getState().consumePendingCreateDraft()).toBeNull();
  });

  it("setPendingCreateDraft(null) clears the slot", () => {
    useWorkStore.getState().setPendingCreateDraft({ prompt: "x" });
    useWorkStore.getState().setPendingCreateDraft(null);
    expect(useWorkStore.getState().pendingCreateDraft).toBeNull();
  });

  it("PendingCreateDraft round-trips the extended fields", () => {
    useWorkStore.getState().setPendingCreateDraft({
      name: "x",
      prompt: "y",
      sources: ["a", "b"],
      scheduleText: "Every Monday at 9am",
      enabled: false,
    });
    expect(useWorkStore.getState().consumePendingCreateDraft()).toEqual({
      name: "x",
      prompt: "y",
      sources: ["a", "b"],
      scheduleText: "Every Monday at 9am",
      enabled: false,
    });
  });

  it("consumePendingEditDraft only returns the draft when the id matches", () => {
    useWorkStore.getState().setPendingEditDraft({
      id: "task-1",
      name: "in-flight",
      sources: ["src"],
    });
    expect(
      useWorkStore.getState().consumePendingEditDraft("task-2"),
    ).toBeNull();
    expect(useWorkStore.getState().pendingEditDraft).not.toBeNull();
    expect(useWorkStore.getState().consumePendingEditDraft("task-1")).toEqual({
      id: "task-1",
      name: "in-flight",
      sources: ["src"],
    });
    expect(useWorkStore.getState().pendingEditDraft).toBeNull();
  });
});
