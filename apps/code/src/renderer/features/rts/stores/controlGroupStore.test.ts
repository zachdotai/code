import { beforeEach, describe, expect, it } from "vitest";
import { useControlGroupStore } from "./controlGroupStore";

describe("controlGroupStore", () => {
  beforeEach(() => {
    useControlGroupStore.setState({ groups: {} });
  });

  it("assigns and clears control groups", () => {
    useControlGroupStore.getState().assign(1, {
      type: "hoglets",
      ids: ["hog-1", "hog-2"],
      includeBuilder: true,
    });

    expect(useControlGroupStore.getState().groups[1]).toEqual({
      type: "hoglets",
      ids: ["hog-1", "hog-2"],
      includeBuilder: true,
    });

    useControlGroupStore.getState().clear(1);

    expect(useControlGroupStore.getState().groups[1]).toBeUndefined();
  });
});
