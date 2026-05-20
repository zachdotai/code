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
  useRtsViewStore,
} from "./rtsViewStore";

describe("rtsViewStore", () => {
  beforeEach(() => {
    useRtsViewStore.setState({
      panX: 0,
      panY: 0,
      zoom: 1,
      fullscreen: false,
      osFullscreen: false,
      bookmarks: {},
    });
  });

  it("clamps zoom and saves camera bookmarks", () => {
    useRtsViewStore.getState().setZoom(100);
    expect(useRtsViewStore.getState().zoom).toBe(HEDGEMONY_ZOOM_MAX);

    useRtsViewStore.getState().setView(10, 20, 0);
    expect(useRtsViewStore.getState()).toMatchObject({
      panX: 10,
      panY: 20,
      zoom: HEDGEMONY_ZOOM_MIN,
    });

    useRtsViewStore.getState().saveBookmark(1);
    expect(useRtsViewStore.getState().bookmarks[1]).toEqual({
      panX: 10,
      panY: 20,
      zoom: HEDGEMONY_ZOOM_MIN,
    });
  });
});
