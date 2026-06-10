import { useCallback } from "react";
import { toast } from "sonner";
import { type BookmarkSlot, useRtsViewStore } from "../stores/rtsViewStore";

export interface UseCameraBookmarksOptions {
  /** Smooth-tween the surface to a saved view. Returning false means the
   * caller couldn't perform the tween (e.g. the surface ref isn't mounted),
   * and the hook falls back to an instant store-only update. The callback is
   * invoked lazily — implementations should read their imperative ref inside,
   * not capture it at hook-call time. */
  animateToView: (panX: number, panY: number, zoom: number) => boolean;
}

export interface CameraBookmarks {
  saveBookmark: (slot: BookmarkSlot) => void;
  recallBookmark: (slot: BookmarkSlot) => void;
}

/**
 * Camera bookmark slots (F5–F7). Save snapshots the current pan/zoom into
 * the persisted view store, recall tweens the surface back to it.
 */
export function useCameraBookmarks({
  animateToView,
}: UseCameraBookmarksOptions): CameraBookmarks {
  const saveBookmarkToStore = useRtsViewStore((s) => s.saveBookmark);
  const setView = useRtsViewStore((s) => s.setView);

  const saveBookmark = useCallback(
    (slot: BookmarkSlot) => {
      saveBookmarkToStore(slot);
      toast(`Saved view ${slot}`, {
        description: `Press F${4 + slot} to jump back.`,
      });
    },
    [saveBookmarkToStore],
  );

  const recallBookmark = useCallback(
    (slot: BookmarkSlot) => {
      const bookmark = useRtsViewStore.getState().bookmarks[slot];
      if (!bookmark) {
        toast(`No view saved in slot ${slot}`, {
          description: `Press Shift+${slot} on the map to save this view.`,
        });
        return;
      }
      // Prefer the smooth-tween path via the surface; fall back to an
      // instant store update if the surface isn't mounted yet (e.g., during
      // unmount races).
      const tweened = animateToView(
        bookmark.panX,
        bookmark.panY,
        bookmark.zoom,
      );
      if (!tweened) {
        setView(bookmark.panX, bookmark.panY, bookmark.zoom);
      }
    },
    [animateToView, setView],
  );

  return { saveBookmark, recallBookmark };
}
