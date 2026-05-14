/**
 * Narrow interface over hoglet world-position overrides. Separated from
 * `HogletRepository` so mutations that only need to reset positions don't
 * depend on the full bucket store.
 */
export interface HogletPositionRepository {
  clearPosition(hogletId: string): void;
  getPosition(hogletId: string): { x: number; y: number } | null;
}
