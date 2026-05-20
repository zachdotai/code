import { useEffect } from "react";
import type { Selection } from "../state/RtsController";
import { useRtsSelectionStore } from "../stores/rtsSelectionStore";

/**
 * Mirrors the hoglet portion of the local selection out to a small global
 * store so the sidebar's task list can highlight tasks linked to selected
 * hoglets. Clearing on unmount keeps the sidebar in sync when the map view
 * tears down (e.g. user navigates away from the command center).
 */
export function useRtsSelectionSync(selection: Selection): void {
  useEffect(() => {
    const ids = selection?.type === "hoglets" ? selection.ids : [];
    useRtsSelectionStore.getState().setSelectedHogletIds(ids);
  }, [selection]);

  useEffect(() => {
    return () => {
      useRtsSelectionStore.getState().clear();
    };
  }, []);
}
