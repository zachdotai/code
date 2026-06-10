import { beforeEach, describe, expect, it } from "vitest";
import { useSpawnDialogStore } from "./spawnDialogStore";

describe("spawnDialogStore", () => {
  beforeEach(() => {
    useSpawnDialogStore.getState().closeSpawnHoglet();
  });

  it("opens and closes the spawn hoglet panel", () => {
    expect(useSpawnDialogStore.getState().spawnHogletOpen).toBe(false);

    useSpawnDialogStore.getState().openSpawnHoglet();
    expect(useSpawnDialogStore.getState().spawnHogletOpen).toBe(true);

    useSpawnDialogStore.getState().closeSpawnHoglet();
    expect(useSpawnDialogStore.getState().spawnHogletOpen).toBe(false);
  });
});
