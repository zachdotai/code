import { useMemo } from "react";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { selectWildHoglets, useHogletStore } from "../stores/hogletStore";
import { WildHoglet } from "./WildHoglet";

/**
 * Wild hoglets live in the WILD_BUCKET with no nest. We give each one a
 * deterministic world position derived from its id, placed in a small ring
 * just outside the hedgehouse footprint so they read as having walked out of
 * the town hall (the hedgehouse sits at the map origin).
 *
 * Subscription to the wild bucket is owned by HedgemonyHoldingPanel (which
 * always mounts) — we just read from the store here.
 */
const RING_INNER = 130;
const RING_THICKNESS = 90;

interface WildHogletFlockProps {
  selectedHogletId: string | null;
  onHogletSelect: (hogletId: string) => void;
}

function hashToUnit(id: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function wildPosition(hogletId: string): { x: number; y: number } {
  const angle = hashToUnit(hogletId, 0) * Math.PI * 2;
  const radius = RING_INNER + hashToUnit(hogletId, 7) * RING_THICKNESS;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export function WildHogletFlock({
  selectedHogletId,
  onHogletSelect,
}: WildHogletFlockProps) {
  const hoglets = useHogletStore(selectWildHoglets);
  const positionOverrides = useHogletPositionStore((s) => s.positions);

  const ordered = useMemo(
    () =>
      [...hoglets].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [hoglets],
  );

  if (ordered.length === 0) return null;

  return (
    <>
      {ordered.map((hoglet, index) => {
        const override = positionOverrides[hoglet.id];
        const { x, y } = override ?? wildPosition(hoglet.id);
        return (
          <WildHoglet
            key={hoglet.id}
            hoglet={hoglet}
            index={index}
            x={x}
            y={y}
            selected={selectedHogletId === hoglet.id}
            onSelect={onHogletSelect}
          />
        );
      })}
    </>
  );
}
