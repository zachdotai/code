import { selectDyingNests, useNestStore } from "../stores/nestStore";
import { DyingNest } from "./DyingNest";

export function DyingNestLayer() {
  const dyingNests = useNestStore(selectDyingNests);

  if (dyingNests.length === 0) return null;

  return (
    <>
      {dyingNests.map((entry) => (
        <DyingNest
          key={entry.nestId}
          nestId={entry.nestId}
          x={entry.x}
          y={entry.y}
        />
      ))}
    </>
  );
}
