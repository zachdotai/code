import { MarkdownRenderer } from "@features/editor/components/MarkdownRenderer";
import { Button } from "@posthog/quill";
import {
  BarChart,
  LineChart,
  type Series,
  Sparkline,
  useChartTheme,
} from "@posthog/quill-charts";
import { Badge, Box, Flex, Grid, Heading, Table, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";
import rehypeSanitize from "rehype-sanitize";

// Presentational bodies for every catalog component, shared by both the view
// renderer (registry.tsx → createRenderer) and the edit renderer
// (EditRenderer.tsx). Keeping the JSX in one place guarantees the two surfaces
// stay pixel-identical.
//
// `ctx` lets the edit renderer inject behaviour without the bodies knowing
// about editing: `text` wraps an editable static string, `data` wraps a locked
// query-derived value. In view mode both are pass-throughs (PLAIN_CTX).

export interface BodyCtx {
  /** Editable static text — inline editor in edit mode, plain text in view. */
  text: (propPath: string, value: string) => ReactNode;
  /** Locked data value — a "from query" hint in edit mode, plain in view. */
  data: (node: ReactNode) => ReactNode;
}

export const PLAIN_CTX: BodyCtx = {
  text: (_propPath, value) => value,
  data: (node) => node,
};

export interface PageProps {
  title?: string;
}
export interface GridProps {
  columns?: number;
}
export interface CardProps {
  title?: string;
}
export interface HeadingProps {
  text: string;
  level?: number;
}
export interface TextProps {
  text: string;
  muted?: boolean;
}
export interface StatProps {
  label: string;
  value: string | number;
  delta?: string;
}
export interface TableProps {
  columns: string[];
  rows: (string | number)[][];
}
export interface BarListProps {
  items: { label: string; value: number }[];
}
export interface BadgeProps {
  text: string;
  color?: "gray" | "green" | "red" | "amber" | "blue";
}
export type CanvasTone = "default" | "muted" | "accent" | "contrast";

// Constrained, theme-aware backgrounds (no arbitrary CSS) so agent-built pages
// stay on-brand and dark-mode-safe. Maps a tone to bg + text classes.
const TONE_CLASS: Record<CanvasTone, string> = {
  default: "",
  muted: "bg-gray-3 text-gray-12",
  accent: "bg-accent-3 text-gray-12",
  contrast: "bg-gray-12 text-gray-1",
};

function toneClass(tone?: CanvasTone): string {
  return TONE_CLASS[tone ?? "default"];
}

export interface HeroProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  ctaText?: string;
  tone?: CanvasTone;
}
export interface SectionProps {
  tone?: CanvasTone;
}
export interface MarkdownProps {
  content: string;
}
export interface ButtonProps {
  text: string;
  variant?: "primary" | "default" | "outline" | "destructive";
}
export interface ChartSeriesInput {
  label: string;
  data: number[];
}
export interface LineChartProps {
  labels: string[];
  series: ChartSeriesInput[];
}
export interface BarChartProps {
  labels: string[];
  series: ChartSeriesInput[];
}
export interface SparklineProps {
  data: number[];
}

export function PageBody({
  props,
  children,
  ctx,
}: {
  props: PageProps;
  children?: ReactNode;
  ctx: BodyCtx;
}) {
  return (
    <Flex direction="column" gap="4" p="5">
      {props.title && (
        <Heading size="6" className="text-gray-12">
          {ctx.text("/title", asText(props.title))}
        </Heading>
      )}
      {children}
    </Flex>
  );
}

export function GridBody({
  props,
  children,
}: {
  props: GridProps;
  children?: ReactNode;
  ctx: BodyCtx;
}) {
  return (
    <Grid columns={String(props.columns ?? 2)} gap="3" width="auto">
      {children}
    </Grid>
  );
}

export function CardBody({
  props,
  children,
  ctx,
}: {
  props: CardProps;
  children?: ReactNode;
  ctx: BodyCtx;
}) {
  return (
    <Box className="rounded-lg border border-gray-6 bg-gray-1 p-4">
      {props.title && (
        <Text size="2" weight="bold" className="mb-2 block text-gray-12">
          {ctx.text("/title", asText(props.title))}
        </Text>
      )}
      {children}
    </Box>
  );
}

export function HeadingBody({
  props,
  ctx,
}: {
  props: HeadingProps;
  ctx: BodyCtx;
}) {
  return (
    <Heading
      size={props.level === 1 ? "6" : props.level === 3 ? "3" : "4"}
      className="text-gray-12"
    >
      {ctx.text("/text", asText(props.text))}
    </Heading>
  );
}

export function TextBody({ props, ctx }: { props: TextProps; ctx: BodyCtx }) {
  return (
    <Text
      size="2"
      as="p"
      className={props.muted ? "text-gray-10" : "text-gray-12"}
    >
      {ctx.text("/text", asText(props.text))}
    </Text>
  );
}

const numberFormat = new Intl.NumberFormat();

// Spec props must be literal strings/numbers — this renderer doesn't resolve
// json-render bindings ({$state}/{$item}/{$bindItem}). If the agent emits one
// anyway, render nothing rather than letting React throw "Objects are not valid
// as a React child" and blanking the whole canvas.
function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

// Group raw numbers (e.g. 34980058 → 34,980,058); leave pre-formatted strings.
function formatStatValue(value: unknown): string {
  return typeof value === "number" ? numberFormat.format(value) : asText(value);
}

export function StatBody({ props, ctx }: { props: StatProps; ctx: BodyCtx }) {
  return (
    <Flex direction="column" gap="1">
      <Text size="1" className="text-gray-10">
        {ctx.text("/label", asText(props.label))}
      </Text>
      <Text size="7" weight="bold" className="text-gray-12">
        {ctx.data(formatStatValue(props.value))}
      </Text>
      {props.delta && (
        <Text size="1" className="text-gray-10">
          {ctx.data(asText(props.delta))}
        </Text>
      )}
    </Flex>
  );
}

export function TableBody({ props }: { props: TableProps; ctx: BodyCtx }) {
  return (
    <Table.Root size="1" variant="surface">
      <Table.Header>
        <Table.Row>
          {props.columns.map((col) => (
            <Table.ColumnHeaderCell key={asText(col)}>
              {asText(col)}
            </Table.ColumnHeaderCell>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {props.rows.map((row, ri) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: spec rows have no id
          <Table.Row key={ri}>
            {row.map((cell, ci) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: spec cells have no id
              <Table.Cell key={ci}>{asText(cell)}</Table.Cell>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}

export function BarListBody({ props }: { props: BarListProps; ctx: BodyCtx }) {
  const items = props.items;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Flex direction="column" gap="2">
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: spec items have no id
        <Flex key={i} align="center" gap="2">
          <Box className="relative h-6 flex-1 overflow-hidden rounded bg-gray-3">
            <Box
              className="absolute inset-y-0 left-0 rounded bg-accent-5"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
            <Text
              size="1"
              className="absolute inset-y-0 left-2 flex items-center text-gray-12"
            >
              {asText(item.label)}
            </Text>
          </Box>
          <Text size="1" weight="bold" className="w-12 text-right text-gray-11">
            {asText(item.value)}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
}

export function BadgeBody({ props, ctx }: { props: BadgeProps; ctx: BodyCtx }) {
  return (
    <Badge color={props.color ?? "gray"}>
      {ctx.text("/text", asText(props.text))}
    </Badge>
  );
}

// Map the LLM-friendly { label, data } catalog shape to quill-charts `Series`.
// `key` keys React/stacked lookups; fall back to the index when labels collide.
function toSeries(series: ChartSeriesInput[]): Series[] {
  return (series ?? []).map((s, i) => ({
    key: s.label || `series-${i}`,
    label: s.label,
    data: s.data ?? [],
  }));
}

export function LineChartBody({
  props,
}: {
  props: LineChartProps;
  ctx: BodyCtx;
}) {
  const theme = useChartTheme();
  // The chart root is `flex:1 1 0`, so it must fill a flex column with a
  // definite height — a plain block lets it collapse to nothing.
  return (
    <Box className="flex h-64 w-full flex-col">
      <LineChart
        labels={props.labels ?? []}
        series={toSeries(props.series)}
        theme={theme}
      />
    </Box>
  );
}

export function BarChartBody({
  props,
}: {
  props: BarChartProps;
  ctx: BodyCtx;
}) {
  const theme = useChartTheme();
  return (
    <Box className="flex h-64 w-full flex-col">
      <BarChart
        labels={props.labels ?? []}
        series={toSeries(props.series)}
        theme={theme}
      />
    </Box>
  );
}

export function SparklineBody({
  props,
}: {
  props: SparklineProps;
  ctx: BodyCtx;
}) {
  const theme = useChartTheme();
  // Sparkline sizes itself via its `height` prop (no flex container needed).
  return (
    <Box className="w-full">
      <Sparkline data={props.data ?? []} theme={theme} height={48} />
    </Box>
  );
}

export function SectionBody({
  props,
  children,
}: {
  props: SectionProps;
  children?: ReactNode;
  ctx: BodyCtx;
}) {
  return (
    <Box className={`rounded-xl px-6 py-8 ${toneClass(props.tone)}`}>
      <Flex direction="column" gap="4">
        {children}
      </Flex>
    </Box>
  );
}

export function HeroBody({ props, ctx }: { props: HeroProps; ctx: BodyCtx }) {
  return (
    <Flex
      direction="column"
      align="center"
      gap="3"
      py="8"
      className={`rounded-xl px-6 text-center ${toneClass(props.tone)}`}
    >
      {props.eyebrow && (
        <Text size="2" weight="bold" className="text-accent-11 uppercase">
          {ctx.text("/eyebrow", asText(props.eyebrow))}
        </Text>
      )}
      <Heading size="9" className="max-w-3xl text-balance text-gray-12">
        {ctx.text("/title", asText(props.title))}
      </Heading>
      {props.subtitle && (
        <Text size="4" className="max-w-2xl text-pretty text-gray-10">
          {ctx.text("/subtitle", asText(props.subtitle))}
        </Text>
      )}
      {props.ctaText && (
        <Button variant="primary" size="lg" className="mt-2">
          {ctx.text("/ctaText", asText(props.ctaText))}
        </Button>
      )}
    </Flex>
  );
}

export function MarkdownBody({
  props,
}: {
  props: MarkdownProps;
  ctx: BodyCtx;
}) {
  return (
    <Box className="text-gray-12">
      {/* Sanitized: Markdown only, raw HTML is stripped (untrusted agent text). */}
      <MarkdownRenderer
        content={asText(props.content)}
        rehypePlugins={[rehypeSanitize]}
      />
    </Box>
  );
}

export function ButtonBody({
  props,
  ctx,
}: {
  props: ButtonProps;
  ctx: BodyCtx;
}) {
  return (
    <Button variant={props.variant ?? "primary"}>
      {ctx.text("/text", asText(props.text))}
    </Button>
  );
}

export function DividerBody() {
  return <Box className="my-2 h-px bg-gray-6" />;
}

// Dispatch a spec element (untyped JSON props) to its presentational body.
// Shared by the edit and view renderers.
export function renderBody(
  type: string,
  props: Record<string, unknown>,
  children: ReactNode,
  ctx: BodyCtx,
): ReactNode {
  const p = props as never;
  switch (type) {
    case "Page":
      return (
        <PageBody props={p} ctx={ctx}>
          {children}
        </PageBody>
      );
    case "Grid":
      return (
        <GridBody props={p} ctx={ctx}>
          {children}
        </GridBody>
      );
    case "Card":
      return (
        <CardBody props={p} ctx={ctx}>
          {children}
        </CardBody>
      );
    case "Heading":
      return <HeadingBody props={p} ctx={ctx} />;
    case "Text":
      return <TextBody props={p} ctx={ctx} />;
    case "Stat":
      return <StatBody props={p} ctx={ctx} />;
    case "Table":
      return <TableBody props={p} ctx={ctx} />;
    case "BarList":
      return <BarListBody props={p} ctx={ctx} />;
    case "LineChart":
      return <LineChartBody props={p} ctx={ctx} />;
    case "BarChart":
      return <BarChartBody props={p} ctx={ctx} />;
    case "Sparkline":
      return <SparklineBody props={p} ctx={ctx} />;
    case "Badge":
      return <BadgeBody props={p} ctx={ctx} />;
    case "Section":
      return (
        <SectionBody props={p} ctx={ctx}>
          {children}
        </SectionBody>
      );
    case "Hero":
      return <HeroBody props={p} ctx={ctx} />;
    case "Markdown":
      return <MarkdownBody props={p} ctx={ctx} />;
    case "Button":
      return <ButtonBody props={p} ctx={ctx} />;
    case "Divider":
      return <DividerBody />;
    default:
      return null;
  }
}
