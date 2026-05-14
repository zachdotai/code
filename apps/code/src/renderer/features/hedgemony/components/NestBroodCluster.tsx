import type { Hoglet, Nest } from "@main/services/hedgemony/schemas";
import { useEffect, useMemo } from "react";
import { initializeNestHogletStore } from "../service/hogletSubscriptionService";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { selectNestHoglets, useHogletStore } from "../stores/hogletStore";
import { selectNests, useNestStore } from "../stores/nestStore";
import {
  broodHogletPosition,
  collectHogletWorldPositions,
} from "../utils/hogletPositions";
import { BroodHoglet } from "./BroodHoglet";

interface NestBroodClusterProps {
  nest: Nest;
  selectedHogletIds: ReadonlySet<string>;
  dimmed?: boolean;
  onHogletSelect: (hogletId: string, additive: boolean) => void;
}

export function NestBroodCluster({
  nest,
  selectedHogletIds,
  dimmed,
  onHogletSelect,
}: NestBroodClusterProps) {
  const hoglets = useHogletStore(selectNestHoglets(nest.id));
  const byBucket = useHogletStore((s) => s.byBucket);
  const positionOverrides = useHogletPositionStore((s) => s.positions);
  const nests = useNestStore(selectNests);

  useEffect(() => {
    return initializeNestHogletStore(nest.id);
  }, [nest.id]);

  const ordered = useMemo<Hoglet[]>(
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
        const position =
          resolvedPositions.get(hoglet.id) ??
          override ??
          broodHogletPosition(index, ordered.length, {
            x: nest.mapX,
            y: nest.mapY,
          });
        return (
          <BroodHoglet
            key={hoglet.id}
            hoglet={hoglet}
            nestId={nest.id}
            index={index}
            x={position.x}
            y={position.y}
            selected={selectedHogletIds.has(hoglet.id)}
            dimmed={dimmed && !selectedHogletIds.has(hoglet.id)}
            onSelect={onHogletSelect}
          />
        );
      })}
    </>
  );
}
