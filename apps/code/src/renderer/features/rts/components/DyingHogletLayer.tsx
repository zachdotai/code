import { selectDyingHoglets, useHogletStore } from "../stores/hogletStore";
import { DyingHoglet } from "./DyingHoglet";

export function DyingHogletLayer() {
  const dyingHoglets = useHogletStore(selectDyingHoglets);

  if (dyingHoglets.length === 0) return null;

  return (
    <>
      {dyingHoglets.map((entry) => (
        <DyingHoglet
          key={entry.hogletId}
          hogletId={entry.hogletId}
          x={entry.x}
          y={entry.y}
        />
      ))}
    </>
  );
}
