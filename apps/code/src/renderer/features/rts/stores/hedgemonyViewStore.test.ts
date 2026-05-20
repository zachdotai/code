import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@utils/electronStorage", () => ({
  electronStorage: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  HEDGEMONY_ZOOM_MAX,
  HEDGEMONY_ZOOM_MIN,
  useHedgemonyViewStore,
} from "./hedgemonyViewStore";

describe("hedgemonyViewStore", () => {
  beforeEach(() => {
    useHedgemonyViewStore.setState({
      panX: 0,
      panY: 0,
      zoom: 1,
      fullscreen: false,
      osFullscreen: false,
      bookmarks: {},
    });
  });

  it("clamps zoom and saves camera bookmarks", () => {
    useHedgemonyViewStore.getState().setZoom(100);
    expect(useHedgemonyViewStore.getState().zoom).toBe(HEDGEMONY_ZOOM_MAX);

    useHedgemonyViewStore.getState().setView(10, 20, 0);
    expect(useHedgemonyViewStore.getState()).toMatchObject({
      panX: 10,
      panY: 20,
      zoom: HEDGEMONY_ZOOM_MIN,
    });

    useHedgemonyViewStore.getState().saveBookmark(1);
    expect(useHedgemonyViewStore.getState().bookmarks[1]).toEqual({
      panX: 10,
      panY: 20,
      zoom: HEDGEMONY_ZOOM_MIN,
    });
  });
});
