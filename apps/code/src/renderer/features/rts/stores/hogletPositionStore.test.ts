import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    secureStore: {
      getItem: { query: vi.fn().mockResolvedValue(null) },
      setItem: { query: vi.fn().mockResolvedValue(undefined) },
      removeItem: { query: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

import {
  selectHogletPosition,
  selectHogletWalkPath,
  useHogletPositionStore,
} from "./hogletPositionStore";

describe("hogletPositionStore", () => {
  beforeEach(() => {
    useHogletPositionStore.getState().reset();
  });

  it("stores rounded integer coordinates for a hoglet", () => {
    useHogletPositionStore.getState().setPosition("hg-1", 12.7, -45.4);
    const position = selectHogletPosition("hg-1")(
      useHogletPositionStore.getState(),
    );
    expect(position).toEqual({ x: 13, y: -45 });
  });

  it("overwrites a prior position for the same hoglet", () => {
    useHogletPositionStore.getState().setPosition("hg-1", 1, 1);
    useHogletPositionStore.getState().setPosition("hg-1", 100, 200);
    expect(useHogletPositionStore.getState().positions["hg-1"]).toEqual({
      x: 100,
      y: 200,
    });
  });

  it("clearPosition removes only the targeted hoglet", () => {
    useHogletPositionStore.getState().setPosition("hg-1", 10, 10);
    useHogletPositionStore.getState().setPosition("hg-2", 20, 20);
    useHogletPositionStore.getState().clearPosition("hg-1");
    expect(useHogletPositionStore.getState().positions).toEqual({
      "hg-2": { x: 20, y: 20 },
    });
  });

  it("clearPosition is a no-op when no override exists", () => {
    const before = useHogletPositionStore.getState().positions;
    useHogletPositionStore.getState().clearPosition("missing");
    expect(useHogletPositionStore.getState().positions).toBe(before);
  });

  it("selectHogletPosition returns undefined when no override is set", () => {
    expect(
      selectHogletPosition("nope")(useHogletPositionStore.getState()),
    ).toBeUndefined();
  });

  it("setWalkPath stores the path and final rounded position", () => {
    const path = [
      { x: 1.2, y: 2.6 },
      { x: 30.4, y: 40.8 },
    ];
    useHogletPositionStore.getState().setWalkPath("hg-1", path);

    expect(useHogletPositionStore.getState().positions["hg-1"]).toEqual({
      x: 30,
      y: 41,
    });
    expect(
      selectHogletWalkPath("hg-1")(useHogletPositionStore.getState()),
    ).toEqual(path);
  });

  it("setPosition clears any existing walk path", () => {
    useHogletPositionStore.getState().setWalkPath("hg-1", [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    useHogletPositionStore.getState().setPosition("hg-1", 100, 200);

    expect(
      selectHogletWalkPath("hg-1")(useHogletPositionStore.getState()),
    ).toBeUndefined();
  });
});
