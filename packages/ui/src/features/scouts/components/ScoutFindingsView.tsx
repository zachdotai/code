import {
  ArrowLeftIcon,
  CompassIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import {
  availableScouts as deriveAvailableScouts,
  latestEmittedAt as deriveLatestEmittedAt,
  FINDINGS_SCOUT_FILTER_ALL,
  FINDINGS_SEVERITIES,
  FINDINGS_SEVERITY_FILTER_ALL,
  type FindingsSortKey,
  filterAndSortFindings,
} from "@posthog/core/scouts/scoutFindings";
import { SCOUT_RUNS_WINDOW_SPAN } from "@posthog/core/scouts/scoutRunsWindow";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { RelativeTimestamp } from "@posthog/ui/primitives/RelativeTimestamp";
import { getPostHogUrl } from "@posthog/ui/utils/urls";
import { Box, Flex, Select, Text, TextField } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useScoutFindings } from "../hooks/useScoutFindings";
import { ScoutEmissionCard } from "./ScoutEmissionCard";
import { ScoutFindingDiscussButton } from "./ScoutFindingDiscussButton";
import { ScoutFindingShareButton } from "./ScoutFindingShareButton";
import { ScoutTaskRunLink } from "./ScoutTaskRunLink";

const SORT_OPTIONS: { value: FindingsSortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "severity", label: "Severity" },
  { value: "confidence", label: "Confidence" },
];

/**
 * Cross-fleet findings browser — every finding the troop emitted in the recent
 * runs window, in one place, newest first, searchable and filterable by scout /
 * severity with a sort toggle. Reuses the per-scout {@link ScoutEmissionCard}
 * with `showScout` on. Read-only; acting on a finding happens in its inbox
 * report. Mirrors the PostHog Cloud `FindingsPanel`, kept structurally aligned
 * so the two surfaces stay in parity as the backend evolves.
 */
export function ScoutFindingsView() {
  const { rows, isLoading, isError, partialFailedRuns, refetch } =
    useScoutFindings();
  const [searchText, setSearchText] = useState("");
  const [scoutFilter, setScoutFilter] = useState(FINDINGS_SCOUT_FILTER_ALL);
  const [severityFilter, setSeverityFilter] = useState(
    FINDINGS_SEVERITY_FILTER_ALL,
  );
  const [sortKey, setSortKey] = useState<FindingsSortKey>("newest");

  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="w-full min-w-0">
        <CompassIcon size={12} className="shrink-0 text-gray-10" />
        <Text
          className="truncate whitespace-nowrap font-medium text-[13px]"
          title="Scout findings"
        >
          Scout findings
        </Text>
      </Flex>
    ),
    [],
  );
  useSetHeaderContent(headerContent);

  const availableScouts = useMemo(() => deriveAvailableScouts(rows), [rows]);
  const filteredRows = useMemo(
    () =>
      filterAndSortFindings(rows, {
        searchText,
        scoutFilter,
        severityFilter,
        sortKey,
      }),
    [rows, searchText, scoutFilter, severityFilter, sortKey],
  );

  const totalCount = rows.length;
  const scoutCount = availableScouts.length;
  const latest = useMemo(() => deriveLatestEmittedAt(rows), [rows]);
  const isFiltering =
    searchText.trim().length > 0 ||
    scoutFilter !== FINDINGS_SCOUT_FILTER_ALL ||
    severityFilter !== FINDINGS_SEVERITY_FILTER_ALL;

  return (
    <Flex direction="column" className="h-full min-h-0">
      <Flex
        direction="column"
        gap="2"
        className="border-(--gray-5) border-b px-6 pt-5 pb-5"
      >
        <Link
          to="/code/agents/scouts"
          className="flex w-fit items-center gap-1 text-[12px] text-gray-10 no-underline hover:text-gray-12"
        >
          <ArrowLeftIcon size={12} />
          Scouts
        </Link>
        <Flex align="center" gap="2">
          <CompassIcon size={20} className="shrink-0 text-(--iris-9)" />
          <Text className="font-bold text-[22px] text-gray-12 leading-tight tracking-tight">
            Scout findings
          </Text>
        </Flex>
        <Text className="max-w-2xl text-pretty text-[12.5px] text-gray-11 leading-relaxed">
          Every signal your scouts have emitted recently, in one place — newest
          first. See what&apos;s been surfaced across the whole troop, which
          scout found it, and the inbox report it fed into.
        </Text>
        {totalCount > 0 ? (
          <Flex align="center" gap="1" className="text-[12px] text-gray-10">
            <Text className="text-[12px] text-gray-10">
              {totalCount} finding{totalCount === 1 ? "" : "s"} · {scoutCount}{" "}
              scout{scoutCount === 1 ? "" : "s"}
            </Text>
            {latest ? (
              <>
                <Text className="text-[12px] text-gray-9">· latest</Text>
                <RelativeTimestamp
                  timestamp={latest}
                  className="text-[12px] text-gray-10"
                />
              </>
            ) : null}
          </Flex>
        ) : null}
        <Text className="text-[12px] text-gray-9">
          Covers findings from the most recent {SCOUT_RUNS_WINDOW_SPAN} of troop
          runs. Older findings live on in the inbox reports they produced.
        </Text>
      </Flex>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <Flex direction="column" gap="4">
            <Flex align="center" gap="2" wrap="wrap">
              <TextField.Root
                type="search"
                placeholder="Search findings…"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                size="2"
                className="min-w-[14rem] flex-1"
              >
                <TextField.Slot>
                  <MagnifyingGlassIcon size={14} className="text-gray-10" />
                </TextField.Slot>
              </TextField.Root>

              <Select.Root
                value={scoutFilter}
                size="2"
                onValueChange={setScoutFilter}
              >
                <Select.Trigger
                  className="min-w-[10rem]"
                  aria-label="Filter by scout"
                />
                <Select.Content>
                  <Select.Item value={FINDINGS_SCOUT_FILTER_ALL}>
                    All scouts
                  </Select.Item>
                  {availableScouts.map((scout) => (
                    <Select.Item key={scout.skillName} value={scout.skillName}>
                      {scout.label} ({scout.count})
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>

              <Select.Root
                value={severityFilter}
                size="2"
                onValueChange={setSeverityFilter}
              >
                <Select.Trigger aria-label="Filter by severity" />
                <Select.Content>
                  <Select.Item value={FINDINGS_SEVERITY_FILTER_ALL}>
                    All severities
                  </Select.Item>
                  {FINDINGS_SEVERITIES.map((severity) => (
                    <Select.Item key={severity} value={severity}>
                      {severity}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>

              <Select.Root
                value={sortKey}
                size="2"
                onValueChange={(value) => setSortKey(value as FindingsSortKey)}
              >
                <Select.Trigger aria-label="Sort findings" />
                <Select.Content>
                  {SORT_OPTIONS.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      Sort: {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>

            {partialFailedRuns > 0 ? (
              <Flex
                align="center"
                gap="2"
                className="rounded-(--radius-2) border border-(--amber-6) bg-(--amber-2) px-3 py-2 text-(--amber-11) text-[12px]"
              >
                <Text className="flex-1 text-(--amber-11) text-[12px]">
                  Some findings couldn&apos;t be loaded, so this list may be
                  incomplete.
                </Text>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="rounded-(--radius-2) border border-(--amber-7) px-2.5 py-1 text-(--amber-11) text-[12px] transition-colors hover:bg-(--amber-3)"
                >
                  Retry
                </button>
              </Flex>
            ) : null}

            <FindingsBody
              isLoading={isLoading}
              isError={isError}
              onRetry={() => refetch()}
              rows={filteredRows}
              isFiltering={isFiltering}
            />
          </Flex>
        </div>
      </div>
    </Flex>
  );
}

function FindingsBody({
  isLoading,
  isError,
  onRetry,
  rows,
  isFiltering,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  rows: ReturnType<typeof filterAndSortFindings>;
  isFiltering: boolean;
}) {
  if (isLoading) {
    return (
      <Flex direction="column" gap="2">
        {[0, 1, 2].map((key) => (
          <Box
            key={key}
            className="h-20 w-full animate-pulse rounded-(--radius-2) bg-(--gray-3)"
          />
        ))}
      </Flex>
    );
  }

  if (isError) {
    return (
      <Flex
        direction="column"
        align="center"
        gap="2"
        className="rounded-(--radius-2) border border-(--gray-6) border-dashed bg-gray-1 px-4 py-8 text-center text-[12.5px] text-gray-11"
      >
        <Text className="text-[12.5px] text-gray-11">
          Couldn&apos;t load findings. The scout API may be unavailable or this
          project may not be enrolled yet.
        </Text>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-(--radius-2) border border-(--gray-7) px-2.5 py-1 text-[12px] text-gray-11 transition-colors hover:bg-(--gray-3)"
        >
          Retry
        </button>
      </Flex>
    );
  }

  if (rows.length === 0) {
    return (
      <Box className="rounded-(--radius-2) border border-(--gray-6) border-dashed bg-gray-1 px-4 py-8 text-center text-[12.5px] text-gray-11">
        {isFiltering
          ? "No findings match your search and filters."
          : "Your scouts haven't emitted any findings yet. As they scan your project, what they surface shows up here."}
      </Box>
    );
  }

  return (
    <Flex direction="column" gap="2">
      {rows.map((row) => {
        const taskRunUrl = row.run.task_url
          ? getPostHogUrl(row.run.task_url)
          : null;
        return (
          <ScoutEmissionCard
            // emission.id, not source_id — a run can re-emit a finding_id, sharing source_id.
            key={row.emission.id}
            emission={row.emission}
            skillName={row.run.skill_name}
            showScout
            linkedReport={row.report}
            actions={
              <>
                <ScoutFindingDiscussButton
                  emission={row.emission}
                  skillName={row.run.skill_name}
                />
                <ScoutFindingShareButton
                  emission={row.emission}
                  skillName={row.run.skill_name}
                />
              </>
            }
            footerEnd={
              taskRunUrl ? (
                <ScoutTaskRunLink run={row.run} taskRunUrl={taskRunUrl} />
              ) : undefined
            }
          />
        );
      })}
    </Flex>
  );
}
