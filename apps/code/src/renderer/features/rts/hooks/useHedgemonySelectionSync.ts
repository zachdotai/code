import { useEffect } from "react";
import type { Selection } from "../state/HedgemonyController";
import { useHedgemonySelectionStore } from "../stores/hedgemonySelectionStore";

/**
 * Mirrors the hoglet portion of the local selection out to a small global
 * store so the sidebar's task list can highlight tasks linked to selected
 * hoglets. Clearing on unmount keeps the sidebar in sync when the map view
 * tears down (e.g. user navigates away from the command center).
 */
export function useHedgemonySelectionSync(selection: Selection): void {
  useEffect(() => {
    const ids = selection?.type === "hoglets" ? selection.ids : [];
    useHedgemonySelectionStore.getState().setSelectedHogletIds(ids);
  }, [selection]);

  useEffect(() => {
    return () => {
      useHedgemonySelectionStore.getState().clear();
    };
  }, []);
}
