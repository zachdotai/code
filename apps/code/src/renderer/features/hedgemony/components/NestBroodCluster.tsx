import type { Hoglet, Nest } from "@main/services/hedgemony/schemas";
import { useEffect, useMemo } from "react";
import { initializeNestHogletStore } from "../service/hogletSubscriptionService";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { selectNestHoglets, useHogletStore } from "../stores/hogletStore";
import { selectNests, useNestStore } from "../stores/nestStore";
import {
  avoidHogletObstacleCollision,
  broodHogletPosition,
} from "../utils/hogletPositions";
import { BroodHoglet } from "./BroodHoglet";

interface NestBroodClusterProps {
  nest: Nest;
  selectedHogletIds: ReadonlySet<string>;
  onHogletSelect: (hogletId: string, additive: boolean) => void;
}

export function NestBroodCluster({
  nest,
  selectedHogletIds,
  onHogletSelect,
}: NestBroodClusterProps) {
  const hoglets = useHogletStore(selectNestHoglets(nest.id));
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

  if (ordered.length === 0) return null;

  return (
    <>
      {ordered.map((hoglet, index) => {
        const override = positionOverrides[hoglet.id];
        const position = avoidHogletObstacleCollision(
          override ??
            broodHogletPosition(index, ordered.length, {
              x: nest.mapX,
              y: nest.mapY,
            }),
          nests,
        );
        return (
          <BroodHoglet
            key={hoglet.id}
            hoglet={hoglet}
            nestId={nest.id}
            index={index}
            x={position.x}
            y={position.y}
            selected={selectedHogletIds.has(hoglet.id)}
            onSelect={onHogletSelect}
          />
        );
      })}
    </>
  );
}
