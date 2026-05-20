import { useEffect } from "react";
import type { ViewMode } from "../state/computeMapClickAction";
import { applyEscape, type Selection } from "../state/RtsController";

export interface UseRtsEscapeKeyOptions {
  mode: ViewMode;
  selection: Selection;
  fullscreen: boolean;
  helperOpen: boolean;
  setMode: (next: ViewMode) => void;
  setSelection: (next: Selection) => void;
  exitFullscreen: () => void;
}

/**
 * Wires window-level Escape to the controller's priority ladder
 * (placement → fullscreen → selection → no-op).
 */
export function useRtsEscapeKey({
  mode,
  selection,
  fullscreen,
  helperOpen,
  setMode,
  setSelection,
  exitFullscreen,
}: UseRtsEscapeKeyOptions): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const result = applyEscape({ mode, selection, fullscreen, helperOpen });
      if (!result.handled) return;
      if (result.exitFullscreen) {
        exitFullscreen();
        return;
      }
      if (result.mode !== mode) setMode(result.mode);
      if (result.selection !== selection) setSelection(result.selection);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    mode,
    selection,
    fullscreen,
    helperOpen,
    setMode,
    setSelection,
    exitFullscreen,
  ]);
}
