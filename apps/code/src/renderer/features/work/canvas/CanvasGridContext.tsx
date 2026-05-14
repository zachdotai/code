import { createContext, type MutableRefObject, useContext } from "react";

export interface CanvasGridMetrics {
  /** Total grid cols (always 12 in this codebase). */
  cols: number;
  /** Pixel width of one column (excluding gap). */
  cellWidth: number;
  /** Pixel height of one row (excluding gap). */
  cellHeight: number;
  /** Pixel gap between cells (both axes). */
  gap: number;
}

interface CanvasGridContextValue {
  /** Imperative measure function — calls `getBoundingClientRect` on the live
   *  grid each time so resize math is accurate even after window resize. */
  measure: () => CanvasGridMetrics | null;
  /** Ref to the grid container, used to scope mouse events. */
  gridRef: MutableRefObject<HTMLElement | null>;
}

export const CanvasGridContext = createContext<CanvasGridContextValue | null>(
  null,
);

export function useCanvasGrid(): CanvasGridContextValue | null {
  return useContext(CanvasGridContext);
}
