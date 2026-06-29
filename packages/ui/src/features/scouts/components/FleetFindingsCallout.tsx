import { ArrowRightIcon, CompassIcon } from "@phosphor-icons/react";
import { mostRecentEmittedRuns } from "@posthog/core/scouts/scoutFindings";
import { RelativeTimestamp } from "@posthog/ui/primitives/RelativeTimestamp";
import { Flex, Text } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useScoutRuns } from "../hooks/useScoutRuns";

/**
 * Findings stat card for the scout fleet section. Surfaces that the troop has
 * emitted findings recently — count + recency — and links into the full
 * cross-fleet findings browse/filter surface. Reads the cheap `emitted_count`
 * sum off the already-polled runs window (no per-run emissions fan-out, that's
 * the page's job). Renders nothing until there's at least one finding, so a
 * fresh project isn't nudged toward an empty page.
 */
export function FleetFindingsCallout() {
  const { data: runsWindow } = useScoutRuns();

  const emittedRuns = useMemo(
    () => mostRecentEmittedRuns(runsWindow?.runs ?? []),
    [runsWindow],
  );

  const totalFindings = emittedRuns.reduce(
    (sum, run) => sum + (run.emitted_count ?? 0),
    0,
  );
  if (totalFindings === 0) {
    return null;
  }

  // Emitted runs are newest-first, so the head dates the most recent finding.
  const latestRun = emittedRuns[0];
  const lastEmittedAt =
    latestRun?.completed_at ?? latestRun?.started_at ?? null;

  return (
    <Link
      to="/code/agents/scouts/findings"
      className="flex w-full items-center gap-3 rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3.5 text-left no-underline transition-colors duration-150 hover:border-(--gray-6) hover:bg-(--gray-2)"
    >
      <CompassIcon size={20} className="shrink-0 text-(--iris-9)" />
      <Flex direction="column" className="min-w-0">
        <Text className="font-medium text-[13px] text-gray-12">
          Scout findings
        </Text>
        <Text className="truncate text-[12px] text-gray-11 leading-snug">
          {totalFindings} finding{totalFindings === 1 ? "" : "s"} your scouts
          emitted recently, across the fleet
          {lastEmittedAt ? (
            <>
              {" · latest "}
              <RelativeTimestamp
                timestamp={lastEmittedAt}
                className="inline text-[12px] text-gray-11"
              />
            </>
          ) : null}
        </Text>
      </Flex>
      <span className="flex-1" />
      <ArrowRightIcon size={14} className="shrink-0 text-gray-10" />
    </Link>
  );
}
