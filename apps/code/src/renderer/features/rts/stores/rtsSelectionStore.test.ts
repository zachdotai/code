import { beforeEach, describe, expect, it } from "vitest";
import { useRtsSelectionStore } from "./rtsSelectionStore";

describe("rtsSelectionStore", () => {
  beforeEach(() => {
    useRtsSelectionStore.getState().clear();
  });

  it("sets and clears selected hoglet ids", () => {
    expect(useRtsSelectionStore.getState().selectedHogletIds).toEqual([]);

    useRtsSelectionStore.getState().setSelectedHogletIds(["a", "b"]);
    expect(useRtsSelectionStore.getState().selectedHogletIds).toEqual([
      "a",
      "b",
    ]);

    useRtsSelectionStore.getState().clear();
    expect(useRtsSelectionStore.getState().selectedHogletIds).toEqual([]);
  });

  it("keeps reference identity when content does not change", () => {
    const setter = useRtsSelectionStore.getState().setSelectedHogletIds;
    setter(["a"]);
    const first = useRtsSelectionStore.getState().selectedHogletIds;
    setter(["a"]);
    const second = useRtsSelectionStore.getState().selectedHogletIds;
    expect(second).toBe(first);
  });

  it("clear is a no-op when already empty", () => {
    const first = useRtsSelectionStore.getState().selectedHogletIds;
    useRtsSelectionStore.getState().clear();
    const second = useRtsSelectionStore.getState().selectedHogletIds;
    expect(second).toBe(first);
  });
});
