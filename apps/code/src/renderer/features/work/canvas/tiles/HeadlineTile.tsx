import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import { ArrowSquareOut, GaugeIcon } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type {
  GridSize,
  HeadlineTile as HeadlineTileType,
} from "@shared/types/work-projects";
import { openUrlInBrowser } from "@utils/browser";
import { memo } from "react";
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
}

function HeadlineTileImpl({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onResizePreview,
  onApplyPending,
  onRejectPending,
}: HeadlineTileProps) {
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
        tile.posthogUrl ? (
          <button
            type="button"
            onClick={() => tile.posthogUrl && openUrlInBrowser(tile.posthogUrl)}
            className="flex items-center gap-1 text-(--gray-10) text-[11px] hover:text-(--gray-12)"
          >
            View in PostHog
            <ArrowSquareOut size={10} weight="bold" />
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

// Headline tile fires a PostHog query — memoize so we don't refetch on every
// unrelated parent re-render. Compare by tile identity + state; callbacks may
// change identity but the tile content is what drives the expensive work.
export const HeadlineTile = memo(
  HeadlineTileImpl,
  (prev, next) => prev.tile === next.tile,
);
