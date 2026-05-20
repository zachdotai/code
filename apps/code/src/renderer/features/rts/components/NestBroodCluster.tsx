import type { Hoglet, Nest } from "@main/services/rts/schemas";
import { useEffect, useMemo } from "react";
import { initializeNestHogletStore } from "../service/hogletSubscriptionService";
import { selectNestHoglets, useHogletStore } from "../stores/hogletStore";
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

  const nestOrigin = useMemo(
    () => ({ x: nest.mapX, y: nest.mapY }),
    [nest.mapX, nest.mapY],
  );

  if (ordered.length === 0) return null;

  return (
    <>
      {ordered.map((hoglet, index) => (
        <BroodHoglet
          key={hoglet.id}
          hoglet={hoglet}
          nestId={nest.id}
          nestOrigin={nestOrigin}
          index={index}
          total={ordered.length}
          selected={selectedHogletIds.has(hoglet.id)}
          dimmed={dimmed && !selectedHogletIds.has(hoglet.id)}
          onSelect={onHogletSelect}
        />
      ))}
    </>
  );
}
