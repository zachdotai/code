import { useMemo } from "react";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { selectWildHoglets, useHogletStore } from "../stores/hogletStore";
import { selectNests, useNestStore } from "../stores/nestStore";
import {
  collectHogletWorldPositions,
  wildHogletPosition,
} from "../utils/hogletPositions";
import { WildHoglet } from "./WildHoglet";

/**
 * Wild hoglets live in the WILD_BUCKET with no nest. We give each one a
 * deterministic world position derived from its id, placed in a small ring
 * just outside the hedgehouse footprint so they read as having walked out of
 * the town hall (the hedgehouse sits at the map origin). Signal-backed
 * hoglets that the affinity router didn't auto-route share this bucket and
 * appear in the flock alongside operator-spawned ad-hoc work — the only
 * visible difference is the robo sprite the WildHoglet component picks when
 * `signalReportId` is set.
 *
 * Subscription to the wild bucket is owned by HedgemonyMapView — we just
 * read from the store here.
 */

interface WildHogletFlockProps {
  selectedHogletIds: ReadonlySet<string>;
  dimmed?: boolean;
  onHogletSelect: (hogletId: string, additive: boolean) => void;
}

export function WildHogletFlock({
  selectedHogletIds,
  dimmed,
  onHogletSelect,
}: WildHogletFlockProps) {
  const hoglets = useHogletStore(selectWildHoglets);
  const byBucket = useHogletStore((s) => s.byBucket);
  const positionOverrides = useHogletPositionStore((s) => s.positions);
  const nests = useNestStore(selectNests);

  const ordered = useMemo(
    () =>
      [...hoglets].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [hoglets],
  );

  const resolvedPositions = useMemo(
    () =>
      new Map(
        collectHogletWorldPositions(nests, byBucket, positionOverrides).map(
          (pos) => [pos.hogletId, pos],
        ),
      ),
    [nests, byBucket, positionOverrides],
  );

  if (ordered.length === 0) return null;

  return (
    <>
      {ordered.map((hoglet, index) => {
        const override = positionOverrides[hoglet.id];
        const { x, y } =
          resolvedPositions.get(hoglet.id) ??
          override ??
          wildHogletPosition(hoglet.id);
        return (
          <WildHoglet
            key={hoglet.id}
            hoglet={hoglet}
            index={index}
            x={x}
            y={y}
            selected={selectedHogletIds.has(hoglet.id)}
            dimmed={dimmed && !selectedHogletIds.has(hoglet.id)}
            onSelect={onHogletSelect}
          />
        );
      })}
    </>
  );
}
