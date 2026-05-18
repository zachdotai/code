import { useCallback, useEffect, useRef, useState } from "react";
import type { MoveMarker } from "../components/HedgemonyMapSurface";
import { HEDGEMONY_CONFIG } from "../config";

export interface UseMoveMarkerResult {
  moveMarker: MoveMarker | null;
  flashMoveMarker: (x: number, y: number) => void;
}

/**
 * Renders a transient move-order marker that fades out after a fixed
 * duration. Each call resets the fade timer so rapid orders don't ghost.
 */
export function useMoveMarker(): UseMoveMarkerResult {
  const [moveMarker, setMoveMarker] = useState<MoveMarker | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const flashMoveMarker = useCallback((x: number, y: number) => {
    const id = Date.now();
    setMoveMarker({ id, x, y });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setMoveMarker((current) => (current?.id === id ? null : current));
    }, HEDGEMONY_CONFIG.animation.moveMarkerMs);
  }, []);

  return { moveMarker, flashMoveMarker };
}
