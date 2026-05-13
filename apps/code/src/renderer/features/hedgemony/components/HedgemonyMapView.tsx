import { HedgemonyEmptyState } from "./HedgemonyEmptyState";
import { HedgemonyMapCanvas } from "./HedgemonyMapCanvas";

export function HedgemonyMapView() {
  const hasNests = false;

  return (
    <HedgemonyMapCanvas overlay={!hasNests ? <HedgemonyEmptyState /> : null} />
  );
}
