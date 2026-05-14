import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import {
  ArrowSquareOut,
  GaugeIcon,
  MagnifyingGlass,
  PencilSimple,
} from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type {
  GridSize,
  HeadlineTile as HeadlineTileType,
} from "@shared/types/work-projects";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { openUrlInBrowser } from "@utils/browser";
import { memo, useMemo, useState } from "react";
import { TileFrame } from "../TileFrame";

interface TrendsResult {
  data: number[];
  labels: string[];
  days: string[];
  count?: number;
  aggregated_value?: number;
  label?: string;
}

interface TrendsResponse {
  results: TrendsResult[];
}

function formatCompactNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function describeDelta(values: number[]): string | null {
  if (values.length < 4) return null;
  const half = Math.floor(values.length / 2);
  const recent = values.slice(values.length - half);
  const prior = values.slice(values.length - half * 2, values.length - half);
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const recentSum = sum(recent);
  const priorSum = sum(prior);
  if (priorSum === 0) {
    return recentSum > 0 ? `+${formatCompactNumber(recentSum)} vs. 0` : null;
  }
  const ratio = recentSum / priorSum;
  if (ratio >= 2) {
    return `+${ratio.toFixed(1)}× vs. prior ${half} days`;
  }
  const pct = ((recentSum - priorSum) / priorSum) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}% vs. prior ${half} days`;
}

function SparklineBars({
  values,
  labels,
}: {
  values: number[];
  labels?: string[];
}) {
  const width = 220;
  const height = 40;
  const gap = 2;
  const n = values.length;
  if (n === 0) return null;
  const max = Math.max(...values, 1);
  const barWidth = Math.max(1, (width - gap * (n - 1)) / n);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label="Trend sparkline"
    >
      <title>Trend sparkline</title>
      {values.map((v, i) => {
        const h = Math.max(1, (v / max) * (height - 2));
        const x = i * (barWidth + gap);
        const y = height - h;
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: stable positional bars
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={h}
            fill="var(--green-11)"
            rx={1}
          >
            <title>{labels?.[i] ? `${labels[i]}: ${v}` : String(v)}</title>
          </rect>
        );
      })}
    </svg>
  );
}

interface HeadlineTileProps {
  tile: HeadlineTileType;
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onResizePreview?: (size: GridSize | null) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  onUpdate?: (patch: {
    label?: string;
    liveLabel?: string;
    query?: { posthogProjectId: number; body: Record<string, unknown> };
    posthogUrl?: string;
    fallbackValue?: string;
    fallbackDelta?: string;
    fallbackSparkline?: number[];
  }) => Promise<void>;
  onClearQuery?: () => Promise<void>;
}

function HeadlineTileImpl({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onResizePreview,
  onApplyPending,
  onRejectPending,
  onUpdate,
  onClearQuery,
}: HeadlineTileProps) {
  const query = tile.query;
  const [picking, setPicking] = useState(false);

  if (!query || picking) {
    return (
      <InsightPicker
        tile={tile}
        currentGridSize={currentGridSize}
        onRemove={onRemove}
        onResizeGrid={onResizeGrid}
        onResizePreview={onResizePreview}
        onApplyPending={onApplyPending}
        onRejectPending={onRejectPending}
        onCancel={query ? () => setPicking(false) : undefined}
        onPick={async (picked) => {
          if (!onUpdate) return;
          await onUpdate({
            label: picked.label,
            liveLabel: picked.label,
            query: picked.query,
            posthogUrl: picked.posthogUrl,
            fallbackValue: picked.label ? "—" : undefined,
          });
          setPicking(false);
        }}
      />
    );
  }

  return (
    <LiveHeadline
      tile={tile}
      currentGridSize={currentGridSize}
      onRemove={onRemove}
      onResizeGrid={onResizeGrid}
      onResizePreview={onResizePreview}
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
      onEdit={onUpdate ? () => setPicking(true) : undefined}
      onClearQuery={onClearQuery}
    />
  );
}

interface LiveHeadlineProps {
  tile: HeadlineTileType;
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onResizePreview?: (size: GridSize | null) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  onEdit?: () => void;
  onClearQuery?: () => Promise<void>;
}

function LiveHeadline({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onResizePreview,
  onApplyPending,
  onRejectPending,
  onEdit,
  onClearQuery: _onClearQuery,
}: LiveHeadlineProps) {
  const query = tile.query;
  const { data, isLoading, isError } = useAuthenticatedQuery<TrendsResponse>(
    [
      "work-project-headline",
      tile.id,
      query?.posthogProjectId,
      JSON.stringify(query?.body ?? null),
    ],
    (client) =>
      client.runQuery<TrendsResponse>(
        // biome-ignore lint/style/noNonNullAssertion: gated by enabled below
        query!.posthogProjectId,
        // biome-ignore lint/style/noNonNullAssertion: gated by enabled below
        query!.body,
      ),
    {
      enabled: !!query,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  );

  const series = data?.results?.[0];
  const liveValues = series?.data;
  const liveLabels = series?.labels;
  const liveTotal = series?.aggregated_value ?? series?.count;

  const usingLive = !!liveValues && liveValues.length > 0;
  const values = usingLive ? liveValues : tile.fallbackSparkline;
  const labels = usingLive ? liveLabels : undefined;
  const valueText = usingLive
    ? formatCompactNumber(liveTotal ?? liveValues.reduce((a, b) => a + b, 0))
    : tile.fallbackValue;
  const deltaText = usingLive
    ? (describeDelta(liveValues) ?? tile.fallbackDelta)
    : tile.fallbackDelta;
  const label = usingLive ? (tile.liveLabel ?? tile.label) : tile.label;

  const statusLabel = isError
    ? "Last refresh failed"
    : isLoading && !usingLive
      ? "Loading…"
      : usingLive
        ? "Live"
        : query
          ? "Cached"
          : "Snapshot";

  return (
    <TileFrame
      tile={tile}
      icon={GaugeIcon}
      label={label}
      headerAction={
        <Flex align="center" gap="2">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              title="Change insight"
              aria-label="Change insight"
              className="flex h-6 w-6 items-center justify-center rounded-(--radius-2) text-(--gray-11) hover:bg-(--gray-3) hover:text-(--gray-12)"
            >
              <PencilSimple size={12} weight="duotone" />
            </button>
          )}
          {tile.posthogUrl && (
            <button
              type="button"
              onClick={() =>
                tile.posthogUrl && openUrlInBrowser(tile.posthogUrl)
              }
              className="flex items-center gap-1 text-(--gray-10) text-[11px] hover:text-(--gray-12)"
            >
              View in PostHog
              <ArrowSquareOut size={10} weight="bold" />
            </button>
          )}
        </Flex>
      }
      currentGridSize={currentGridSize}
      onRemove={onRemove}
      onResizeGrid={onResizeGrid}
      onResizePreview={onResizePreview}
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
    >
      <Box className="px-4 py-3">
        <Flex align="center" gap="2">
          <Box
            className={`h-1.5 w-1.5 rounded-full ${
              isError
                ? "bg-(--red-9)"
                : usingLive
                  ? "animate-pulse bg-(--green-9)"
                  : "bg-(--gray-8)"
            }`}
          />
          <Text
            as="span"
            className="text-(--gray-10) text-[11px] uppercase tracking-wide"
          >
            {statusLabel}
          </Text>
        </Flex>
        <Flex align="baseline" gap="3" className="mt-1">
          <Text
            as="span"
            weight="medium"
            className="text-(--gray-12) text-[32px] leading-tight"
          >
            {valueText}
          </Text>
          <Text as="span" className="text-(--green-11) text-[12px]">
            {deltaText}
          </Text>
        </Flex>
        <Box className="mt-2">
          <SparklineBars values={values} labels={labels} />
        </Box>
      </Box>
    </TileFrame>
  );
}

interface InsightSummary {
  id: number;
  short_id: string;
  name: string | null;
  derived_name: string | null;
  description: string | null;
  query: Record<string, unknown> | null;
}

interface PickedInsight {
  label: string;
  query: { posthogProjectId: number; body: Record<string, unknown> };
  posthogUrl: string;
}

interface InsightPickerProps {
  tile: HeadlineTileType;
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onResizePreview?: (size: GridSize | null) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  onCancel?: () => void;
  onPick: (picked: PickedInsight) => Promise<void>;
}

/** Pull the runnable query body out of an insight. PostHog wraps non-legacy
 *  insights in an `InsightVizNode` whose `source` is the actual TrendsQuery;
 *  legacy insights only have `filters` and aren't supported here. */
function extractQueryBody(
  raw: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!raw) return null;
  const kind = typeof raw.kind === "string" ? raw.kind : null;
  if (kind === "InsightVizNode" && typeof raw.source === "object") {
    return raw.source as Record<string, unknown>;
  }
  if (kind === "TrendsQuery") return raw;
  return null;
}

function insightSupports(insight: InsightSummary): boolean {
  const body = extractQueryBody(insight.query);
  if (!body) return false;
  return body.kind === "TrendsQuery";
}

function displayName(insight: InsightSummary): string {
  const name = insight.name?.trim() || insight.derived_name?.trim();
  return name && name.length > 0 ? name : `Insight ${insight.short_id}`;
}

function InsightPicker({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onResizePreview,
  onApplyPending,
  onRejectPending,
  onCancel,
  onPick,
}: InsightPickerProps) {
  const [search, setSearch] = useState("");
  const projectId = useAuthStateValue((s) => s.projectId);
  const cloudRegion = useAuthStateValue((s) => s.cloudRegion);
  const [picking, setPicking] = useState(false);

  const { data, isLoading, isError, error } = useAuthenticatedQuery<
    InsightSummary[]
  >(
    ["work-project-headline-insight-search", projectId, search],
    (client) => {
      if (!projectId) return Promise.resolve([]);
      return client.searchInsights(projectId, {
        search: search.trim() || undefined,
        limit: 30,
      });
    },
    {
      enabled: !!projectId,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  );

  const filtered = useMemo(() => (data ?? []).filter(insightSupports), [data]);

  const handlePick = async (insight: InsightSummary) => {
    if (!projectId || !cloudRegion || picking) return;
    const body = extractQueryBody(insight.query);
    if (!body) return;
    setPicking(true);
    try {
      const cloudUrl = getCloudUrlFromRegion(cloudRegion);
      await onPick({
        label: displayName(insight),
        query: { posthogProjectId: projectId, body },
        posthogUrl: `${cloudUrl}/project/${projectId}/insights/${insight.short_id}`,
      });
    } finally {
      setPicking(false);
    }
  };

  return (
    <TileFrame
      tile={tile}
      icon={GaugeIcon}
      label={tile.label || "Headline metric"}
      headerAction={
        onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="text-(--gray-10) text-[11px] hover:text-(--gray-12)"
          >
            Cancel
          </button>
        ) : undefined
      }
      currentGridSize={currentGridSize}
      onRemove={onRemove}
      onResizeGrid={onResizeGrid}
      onResizePreview={onResizePreview}
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
    >
      <Flex direction="column" className="h-full min-h-0">
        {!projectId ? (
          <Flex
            align="center"
            justify="center"
            className="h-full px-4 py-3 text-center text-(--gray-10) text-[12px]"
          >
            Connect a PostHog project to pick an insight.
          </Flex>
        ) : (
          <>
            <Box className="shrink-0 border-(--gray-4) border-b px-3 py-2">
              <Flex
                align="center"
                gap="2"
                className="rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2.5 py-1.5 focus-within:border-(--accent-7)"
              >
                <MagnifyingGlass
                  size={12}
                  weight="duotone"
                  className="shrink-0 text-(--gray-10)"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search your PostHog insights…"
                  className="block w-full bg-transparent text-(--gray-12) text-[12px] outline-none placeholder:text-(--gray-9)"
                />
              </Flex>
            </Box>
            <Box className="scrollbar-overlay-y min-h-0 flex-1 overflow-y-auto">
              {isLoading && (data ?? []).length === 0 ? (
                <Flex
                  align="center"
                  justify="center"
                  className="h-full px-4 py-6 text-(--gray-10) text-[12px]"
                >
                  Loading insights…
                </Flex>
              ) : isError ? (
                <Flex
                  align="center"
                  justify="center"
                  className="h-full px-4 py-6 text-center text-(--red-11) text-[12px]"
                >
                  {error instanceof Error
                    ? error.message
                    : "Couldn't load insights."}
                </Flex>
              ) : filtered.length === 0 ? (
                <Flex
                  align="center"
                  justify="center"
                  className="h-full px-4 py-6 text-center text-(--gray-10) text-[12px]"
                >
                  {search
                    ? `No trends insights match "${search}".`
                    : "No trends insights in this project yet."}
                </Flex>
              ) : (
                <Flex direction="column">
                  {filtered.map((insight) => (
                    <button
                      key={insight.id}
                      type="button"
                      disabled={picking}
                      onClick={() => {
                        void handlePick(insight);
                      }}
                      className="flex w-full flex-col items-start gap-0.5 border-(--gray-3) border-b px-4 py-2 text-left transition-colors last:border-b-0 hover:bg-(--gray-2) disabled:cursor-wait disabled:opacity-60"
                    >
                      <Text
                        as="span"
                        className="truncate text-(--gray-12) text-[12px] leading-tight"
                      >
                        {displayName(insight)}
                      </Text>
                      {insight.description && (
                        <Text
                          as="span"
                          className="truncate text-(--gray-10) text-[11px] leading-snug"
                        >
                          {insight.description}
                        </Text>
                      )}
                    </button>
                  ))}
                </Flex>
              )}
            </Box>
          </>
        )}
      </Flex>
    </TileFrame>
  );
}

// Headline tile fires a PostHog query – memoize so we don't refetch on every
// unrelated parent re-render. Compare by tile identity + state; callbacks may
// change identity but the tile content is what drives the expensive work.
export const HeadlineTile = memo(
  HeadlineTileImpl,
  (prev, next) =>
    prev.tile === next.tile &&
    prev.onUpdate === next.onUpdate &&
    prev.onClearQuery === next.onClearQuery,
);
