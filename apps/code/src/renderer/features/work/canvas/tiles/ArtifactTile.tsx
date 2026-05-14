import {
  ArrowSquareOut,
  ChartBar,
  ChecksIcon,
  Code as CodeIcon,
  LinkSimple,
  Table as TableIcon,
} from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type {
  ArtifactKind,
  ArtifactTile as ArtifactTileType,
  GridSize,
} from "@shared/types/work-projects";
import { openUrlInBrowser } from "@utils/browser";
import { useMemo } from "react";
import { TileFrame } from "../TileFrame";

interface ArtifactTileProps {
  tile: ArtifactTileType;
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onResizePreview?: (size: GridSize | null) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  onUpdateChecklistItems?: (
    items: Array<{ text: string; done: boolean }>,
  ) => void;
}

const KIND_ICON: Record<ArtifactKind, typeof ChecksIcon> = {
  checklist: ChecksIcon,
  table: TableIcon,
  chart: ChartBar,
  code: CodeIcon,
  embed: LinkSimple,
};

export function ArtifactTile({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onResizePreview,
  onApplyPending,
  onRejectPending,
  onUpdateChecklistItems,
}: ArtifactTileProps) {
  const Icon = KIND_ICON[tile.kind] ?? ChecksIcon;
  return (
    <TileFrame
      tile={tile}
      icon={Icon}
      label={tile.title}
      currentGridSize={currentGridSize}
      onRemove={onRemove}
      onResizeGrid={onResizeGrid}
      onResizePreview={onResizePreview}
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
    >
      <ArtifactBody
        tile={tile}
        onUpdateChecklistItems={onUpdateChecklistItems}
      />
    </TileFrame>
  );
}

function ArtifactBody({
  tile,
  onUpdateChecklistItems,
}: {
  tile: ArtifactTileType;
  onUpdateChecklistItems?: (
    items: Array<{ text: string; done: boolean }>,
  ) => void;
}) {
  switch (tile.kind) {
    case "checklist":
      return (
        <ChecklistBody data={tile.data} onUpdate={onUpdateChecklistItems} />
      );
    case "table":
      return <TableBody data={tile.data} />;
    case "chart":
      return <ChartBody data={tile.data} />;
    case "code":
      return <CodeBody data={tile.data} />;
    case "embed":
      return <EmbedBody data={tile.data} />;
    default:
      return <UnsupportedBody kind={tile.kind} />;
  }
}

function UnsupportedBody({ kind }: { kind: string }) {
  return (
    <Box className="px-3 py-2">
      <Text as="div" className="text-(--gray-11) text-[12px]">
        Unsupported artifact kind: <code>{kind}</code>
      </Text>
    </Box>
  );
}

// ---------- Checklist ----------

interface ChecklistItem {
  text: string;
  done: boolean;
}

function readChecklistItems(data: Record<string, unknown>): ChecklistItem[] {
  const raw = data.items;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): ChecklistItem | null => {
      if (!entry || typeof entry !== "object") return null;
      const obj = entry as Record<string, unknown>;
      const text = typeof obj.text === "string" ? obj.text : "";
      const done = typeof obj.done === "boolean" ? obj.done : false;
      return { text, done };
    })
    .filter((v): v is ChecklistItem => v !== null);
}

function ChecklistBody({
  data,
  onUpdate,
}: {
  data: Record<string, unknown>;
  onUpdate?: (items: ChecklistItem[]) => void;
}) {
  const items = useMemo(() => readChecklistItems(data), [data]);
  const handleToggle = (index: number) => {
    if (!onUpdate) return;
    const next = items.map((it, i) =>
      i === index ? { ...it, done: !it.done } : it,
    );
    onUpdate(next);
  };
  if (items.length === 0) {
    return (
      <Box className="px-3 py-2">
        <Text as="div" className="text-(--gray-11) text-[12px]">
          Empty checklist.
        </Text>
      </Box>
    );
  }
  return (
    <Flex direction="column" className="px-3 py-2">
      {items.map((item, i) => (
        <Flex
          // biome-ignore lint/suspicious/noArrayIndexKey: list is ordered, stable per render
          key={i}
          align="start"
          gap="2"
          className="cursor-pointer py-1 text-[13px] hover:bg-(--gray-2)"
          onClick={() => handleToggle(i)}
        >
          <Box
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-(--radius-2) border ${
              item.done
                ? "border-(--accent-9) bg-(--accent-9) text-(--accent-1)"
                : "border-(--gray-7)"
            }`}
          >
            {item.done && (
              <svg
                viewBox="0 0 12 12"
                className="h-3 w-3"
                role="presentation"
                aria-hidden="true"
              >
                <title>Checked</title>
                <path
                  d="M 2 6 L 5 9 L 10 3"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </Box>
          <Text
            as="span"
            className={`min-w-0 break-words text-[13px] ${
              item.done ? "text-(--gray-10) line-through" : "text-(--gray-12)"
            }`}
          >
            {item.text}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
}

// ---------- Table ----------

function TableBody({ data }: { data: Record<string, unknown> }) {
  const headers = Array.isArray(data.headers)
    ? (data.headers as unknown[]).map((v) => String(v ?? ""))
    : [];
  const rows = Array.isArray(data.rows)
    ? (data.rows as unknown[]).map((row) =>
        Array.isArray(row)
          ? (row as unknown[]).map((v) => String(v ?? ""))
          : [],
      )
    : [];
  if (headers.length === 0 && rows.length === 0) {
    return (
      <Box className="px-3 py-2">
        <Text as="div" className="text-(--gray-11) text-[12px]">
          Empty table.
        </Text>
      </Box>
    );
  }
  return (
    <Box className="overflow-auto px-1 py-1">
      <table className="w-full text-[12px]">
        {headers.length > 0 && (
          <thead>
            <tr>
              {headers.map((h) => (
                <th
                  key={h}
                  className="border-(--gray-4) border-b px-2 py-1 text-left font-medium text-(--gray-11) text-[11px] uppercase tracking-wide"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, ri) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: row index is stable for read-only display
            <tr key={ri} className="border-(--gray-3) border-b last:border-b-0">
              {row.map((cell, ci) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: cell index is stable for read-only display
                  key={ci}
                  className="px-2 py-1 align-top text-(--gray-12)"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

// ---------- Chart ----------

interface ChartSeriesPoint {
  label: string;
  value: number;
}

function readChartSeries(data: Record<string, unknown>): ChartSeriesPoint[] {
  const raw = data.series;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p): ChartSeriesPoint | null => {
      if (!p || typeof p !== "object") return null;
      const obj = p as Record<string, unknown>;
      const label = typeof obj.label === "string" ? obj.label : "";
      const value = typeof obj.value === "number" ? obj.value : null;
      if (value === null) return null;
      return { label, value };
    })
    .filter((v): v is ChartSeriesPoint => v !== null);
}

function ChartBody({ data }: { data: Record<string, unknown> }) {
  const kind = data.chartKind === "line" ? "line" : "bar";
  const unit = typeof data.unit === "string" ? data.unit : undefined;
  const series = useMemo(() => readChartSeries(data), [data]);
  if (series.length === 0) {
    return (
      <Box className="px-3 py-2">
        <Text as="div" className="text-(--gray-11) text-[12px]">
          No data to chart.
        </Text>
      </Box>
    );
  }
  const max = Math.max(...series.map((s) => s.value), 0);
  const safeMax = max === 0 ? 1 : max;
  if (kind === "line") {
    return (
      <Box className="flex h-full min-h-0 flex-col px-3 py-2">
        <Box className="min-h-0 flex-1">
          <LineChart series={series} max={safeMax} />
        </Box>
        <Flex justify="between" className="mt-1 text-(--gray-10) text-[10px]">
          <span>{series[0]?.label}</span>
          <span>{series[series.length - 1]?.label}</span>
        </Flex>
      </Box>
    );
  }
  return (
    <Flex
      direction="column"
      gap="1"
      className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
    >
      {series.map((point, i) => {
        const pct = (point.value / safeMax) * 100;
        return (
          <Flex
            // biome-ignore lint/suspicious/noArrayIndexKey: ordered series, stable index
            key={i}
            align="center"
            gap="2"
            className="text-[11px]"
          >
            <Text
              as="span"
              className="w-20 shrink-0 truncate text-(--gray-11)"
              title={point.label}
            >
              {point.label}
            </Text>
            <Box className="min-w-0 flex-1">
              <Box className="h-2 overflow-hidden rounded-full bg-(--gray-3)">
                <Box
                  className="h-full rounded-full bg-(--accent-9)"
                  style={{ width: `${pct}%` }}
                />
              </Box>
            </Box>
            <Text
              as="span"
              className="w-14 shrink-0 text-right text-(--gray-12)"
            >
              {formatChartValue(point.value)}
              {unit ? ` ${unit}` : ""}
            </Text>
          </Flex>
        );
      })}
    </Flex>
  );
}

function LineChart({
  series,
  max,
}: {
  series: ChartSeriesPoint[];
  max: number;
}) {
  const w = 320;
  const h = 80;
  const padX = 4;
  const padY = 6;
  const usableW = w - padX * 2;
  const usableH = h - padY * 2;
  const points = series
    .map((p, i) => {
      const x = padX + (i / Math.max(series.length - 1, 1)) * usableW;
      const y = padY + (1 - p.value / max) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-full w-full"
      role="presentation"
      aria-hidden="true"
    >
      <title>Line chart</title>
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent-9)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function formatChartValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

// ---------- Code ----------

function CodeBody({ data }: { data: Record<string, unknown> }) {
  const body = typeof data.body === "string" ? data.body : "";
  const language = typeof data.language === "string" ? data.language : "";
  if (!body) {
    return (
      <Box className="px-3 py-2">
        <Text as="div" className="text-(--gray-11) text-[12px]">
          Empty code block.
        </Text>
      </Box>
    );
  }
  return (
    <Box className="flex h-full min-h-0 flex-col">
      {language && (
        <Text
          as="div"
          className="shrink-0 border-(--gray-4) border-b px-3 py-1 text-(--gray-10) text-[10px] uppercase tracking-wide"
        >
          {language}
        </Text>
      )}
      <Box className="min-h-0 flex-1 overflow-auto bg-(--gray-2) p-3">
        <pre className="m-0 whitespace-pre-wrap break-words font-mono text-(--gray-12) text-[12px] leading-snug">
          {body}
        </pre>
      </Box>
    </Box>
  );
}

// ---------- Embed ----------

function EmbedBody({ data }: { data: Record<string, unknown> }) {
  const url = typeof data.url === "string" ? data.url : "";
  const description =
    typeof data.description === "string" ? data.description : undefined;
  if (!url) {
    return (
      <Box className="px-3 py-2">
        <Text as="div" className="text-(--gray-11) text-[12px]">
          No URL.
        </Text>
      </Box>
    );
  }
  const display = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <Flex
      direction="column"
      gap="2"
      className="h-full min-h-0 justify-between px-3 py-3"
    >
      <Flex direction="column" gap="1" className="min-h-0">
        <Text
          as="div"
          weight="medium"
          className="truncate text-(--gray-12) text-[13px]"
          title={url}
        >
          {display}
        </Text>
        {description && (
          <Text
            as="div"
            className="line-clamp-3 text-(--gray-11) text-[12px] leading-snug"
          >
            {description}
          </Text>
        )}
      </Flex>
      <button
        type="button"
        onClick={() => openUrlInBrowser(url)}
        className="self-start rounded-(--radius-2) bg-(--gray-3) px-2 py-1 text-(--gray-12) text-[11px] transition-colors hover:bg-(--gray-4)"
      >
        <Flex align="center" gap="1">
          <span>Open</span>
          <ArrowSquareOut size={10} weight="bold" />
        </Flex>
      </button>
    </Flex>
  );
}
