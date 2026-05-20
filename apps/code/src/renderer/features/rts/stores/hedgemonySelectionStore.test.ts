import { beforeEach, describe, expect, it } from "vitest";
import { useHedgemonySelectionStore } from "./hedgemonySelectionStore";

describe("hedgemonySelectionStore", () => {
  beforeEach(() => {
    useHedgemonySelectionStore.getState().clear();
  });

  it("sets and clears selected hoglet ids", () => {
    expect(useHedgemonySelectionStore.getState().selectedHogletIds).toEqual([]);

    useHedgemonySelectionStore.getState().setSelectedHogletIds(["a", "b"]);
    expect(useHedgemonySelectionStore.getState().selectedHogletIds).toEqual([
      "a",
      "b",
    ]);

    useHedgemonySelectionStore.getState().clear();
    expect(useHedgemonySelectionStore.getState().selectedHogletIds).toEqual([]);
  });

  it("keeps reference identity when content does not change", () => {
    const setter = useHedgemonySelectionStore.getState().setSelectedHogletIds;
    setter(["a"]);
    const first = useHedgemonySelectionStore.getState().selectedHogletIds;
    setter(["a"]);
    const second = useHedgemonySelectionStore.getState().selectedHogletIds;
    expect(second).toBe(first);
  });

  it("clear is a no-op when already empty", () => {
    const first = useHedgemonySelectionStore.getState().selectedHogletIds;
    useHedgemonySelectionStore.getState().clear();
    const second = useHedgemonySelectionStore.getState().selectedHogletIds;
    expect(second).toBe(first);
  });
});
