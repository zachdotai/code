import { ArrowSquareOut, ChartLineUp } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type {
  GridSize,
  InsightTile as InsightTileType,
} from "@shared/types/work-projects";
import { openUrlInBrowser } from "@utils/browser";
import { TileFrame } from "../TileFrame";

interface InsightTileProps {
  tile: InsightTileType;
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onResizePreview?: (size: GridSize | null) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
}

// Deterministic-by-tile-id stylized chart "sketch" — gives the tile a visual
// anchor without faking real data. The seed comes from the tile id so each
// tile reads as its own preview while staying stable across renders.
function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function PreviewSketch({ seed }: { seed: string }) {
  const h = hash(seed);
  const points = Array.from({ length: 12 }, (_, i) => {
    const wobble = Math.sin((h % 100) * 0.1 + i * 0.7) * 0.3;
    const drift = (i / 11) * 0.5;
    return 0.35 + drift + wobble * 0.25;
  });
  const width = 280;
  const height = 56;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - p * height;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const areaPath = `${path} L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label="Insight preview"
    >
      <title>Insight preview</title>
      <defs>
        <linearGradient id={`insight-fill-${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-9)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--accent-9)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#insight-fill-${seed})`} />
      <path
        d={path}
        fill="none"
        stroke="var(--accent-9)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function InsightTile({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onResizePreview,
  onApplyPending,
  onRejectPending,
}: InsightTileProps) {
  return (
    <TileFrame
      tile={tile}
      icon={ChartLineUp}
      label={tile.dashboardId ? "PostHog dashboard" : "PostHog insight"}
      headerAction={
        <button
          type="button"
          onClick={() => openUrlInBrowser(tile.url)}
          className="flex items-center gap-1 text-(--gray-10) text-[11px] hover:text-(--gray-12)"
        >
          Open
          <ArrowSquareOut size={10} weight="bold" />
        </button>
      }
      currentGridSize={currentGridSize}
      onRemove={onRemove}
      onResizeGrid={onResizeGrid}
      onResizePreview={onResizePreview}
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
    >
      <Flex direction="column" gap="2" className="px-4 py-3">
        <Text
          as="div"
          weight="medium"
          className="text-(--gray-12) text-[14px] leading-tight"
        >
          {tile.title}
        </Text>
        {tile.description && (
          <Text
            as="div"
            className="line-clamp-2 text-(--gray-11) text-[12px] leading-snug"
          >
            {tile.description}
          </Text>
        )}
        <Box className="-mx-1 mt-1 overflow-hidden rounded-(--radius-2) bg-(--gray-2)">
          <PreviewSketch seed={tile.id} />
        </Box>
        {tile.owner && (
          <Flex align="center" gap="2" className="mt-0.5">
            <Box
              className="flex h-4 w-4 items-center justify-center rounded-full bg-(--gray-4) text-(--gray-12) text-[8px] uppercase"
              title={tile.owner}
            >
              {tile.owner.slice(0, 1)}
            </Box>
            <Text as="span" className="text-(--gray-10) text-[11px]">
              {tile.owner}
            </Text>
          </Flex>
        )}
      </Flex>
    </TileFrame>
  );
}
