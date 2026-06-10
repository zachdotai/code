import { useMemo } from "react";
import { selectWildHoglets, useHogletStore } from "../stores/hogletStore";
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
 * Subscription to the wild bucket is owned by RtsMapView — we just
 * read from the store here. Per-hoglet position overrides are read inside
 * each WildHoglet so a single hoglet moving doesn't re-render the whole flock.
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
      {ordered.map((hoglet, index) => (
        <WildHoglet
          key={hoglet.id}
          hoglet={hoglet}
          index={index}
          selected={selectedHogletIds.has(hoglet.id)}
          dimmed={dimmed && !selectedHogletIds.has(hoglet.id)}
          onSelect={onHogletSelect}
        />
      ))}
    </>
  );
}
