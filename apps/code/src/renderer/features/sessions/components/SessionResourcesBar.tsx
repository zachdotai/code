import { Tooltip } from "@components/ui/Tooltip";
import { CHAT_CONTENT_MAX_WIDTH } from "@features/sessions/constants";
import type { IconProps } from "@phosphor-icons/react";
import {
  BrainIcon,
  BugIcon,
  ChartLineIcon,
  ClipboardTextIcon,
  CodeIcon,
  DatabaseIcon,
  FileTextIcon,
  FlagIcon,
  FlaskIcon,
  GaugeIcon,
  GlobeIcon,
  PlugIcon,
  SparkleIcon,
  TableIcon,
  VideoIcon,
} from "@phosphor-icons/react";
import type { PostHogProductId } from "@posthog/agent";
import { Badge, Box, Flex, Text } from "@radix-ui/themes";
import type { AcpMessage } from "@shared/types/session-events";
import { openUrlInBrowser } from "@utils/browser";
import { type ComponentType, useMemo } from "react";
import {
  accumulateSessionResources,
  type ResourceProduct,
} from "./accumulateSessionResources";

/**
 * Icon per PostHog product. `Record<PostHogProductId, …>` keeps this exhaustive:
 * adding a product id in `@posthog/agent` forces an icon here at compile time.
 */
const PRODUCT_ICON: Record<PostHogProductId, ComponentType<IconProps>> = {
  product_analytics: ChartLineIcon,
  web_analytics: GlobeIcon,
  feature_flags: FlagIcon,
  experiments: FlaskIcon,
  error_tracking: BugIcon,
  session_replay: VideoIcon,
  surveys: ClipboardTextIcon,
  llm_analytics: BrainIcon,
  data_warehouse: DatabaseIcon,
  cdp: PlugIcon,
  logs: FileTextIcon,
  apm: GaugeIcon,
  sql: TableIcon,
  code: CodeIcon,
  posthog: SparkleIcon,
};

/**
 * Docs page on posthog.com per product, so a chip links to the relevant
 * product docs. `Partial` on purpose — products without a dedicated docs page
 * render as a plain, non-clickable badge rather than linking somewhere
 * misleading. Deliberately excluded:
 *  - `code`: this chip means "the agent read files from your repository", not a
 *    PostHog data product, so it must not link to the /code marketing page.
 *  - `apm`: PostHog folds APM into LLM analytics / Logs, no standalone page.
 */
const PRODUCT_DOC_URL: Partial<Record<PostHogProductId, string>> = {
  product_analytics: "https://posthog.com/docs/product-analytics",
  web_analytics: "https://posthog.com/docs/web-analytics",
  feature_flags: "https://posthog.com/docs/feature-flags",
  experiments: "https://posthog.com/docs/experiments",
  error_tracking: "https://posthog.com/docs/error-tracking",
  session_replay: "https://posthog.com/docs/session-replay",
  surveys: "https://posthog.com/docs/surveys",
  llm_analytics: "https://posthog.com/docs/ai-observability",
  data_warehouse: "https://posthog.com/docs/data-warehouse",
  cdp: "https://posthog.com/docs/cdp",
  logs: "https://posthog.com/docs/logs",
  sql: "https://posthog.com/docs/sql",
  posthog: "https://posthog.com/docs",
};

/**
 * Per-product hover explanation. For products that link to docs the default
 * "Open … docs" is enough; the entries here override that for chips whose
 * meaning isn't obvious from the label alone.
 */
const PRODUCT_TOOLTIP: Partial<Record<PostHogProductId, string>> = {
  code: "PostHog Code read files from your repository this session",
};

interface SessionResourcesBarProps {
  events: AcpMessage[];
}

/**
 * A single product chip. Clickable chips (those with a docs page) open it on
 * click; chips get a tooltip only when it adds something beyond the label —
 * a per-product explanation or an "open docs" hint — otherwise they render
 * bare (e.g. apm).
 */
function ResourceChip({ id, label }: ResourceProduct) {
  const Icon = PRODUCT_ICON[id] ?? SparkleIcon;
  const docUrl = PRODUCT_DOC_URL[id];
  const tooltip =
    PRODUCT_TOOLTIP[id] ?? (docUrl ? `Open ${label} docs` : undefined);

  const badge = (
    <Badge
      size="1"
      color="gray"
      variant="soft"
      className={docUrl ? "cursor-pointer hover:bg-gray-4" : undefined}
      onClick={docUrl ? () => void openUrlInBrowser(docUrl) : undefined}
    >
      <Icon size={12} />
      {label}
    </Badge>
  );

  if (!tooltip) return badge;
  return <Tooltip content={tooltip}>{badge}</Tooltip>;
}

/**
 * Persistent bar above the composer listing the PostHog products the agent has
 * drawn on so far this session — via the MCP `exec` tool, or by reading a file
 * from the codebase (the "Code" chip). It's a transparency hint: at a glance
 * you can see which parts of PostHog grounded the answer. Each product appears
 * once and is added the moment it's first used. Chips that map to a product
 * docs page open it on click; others (e.g. "Code") are informational only.
 * Hidden until at least one product has been used. Mirrors PlanStatusBar's
 * placement and styling.
 */
export function SessionResourcesBar({ events }: SessionResourcesBarProps) {
  const products = useMemo(() => accumulateSessionResources(events), [events]);

  if (products.length === 0) return null;

  return (
    <Box className="mb-3">
      <Box className="mx-auto" style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}>
        <Flex align="center" gap="2" wrap="wrap" className="px-3 pt-2">
          <Tooltip content="PostHog products the agent drew on while working on this session. Click a product to open its docs.">
            <Text
              color="gray"
              className="cursor-default whitespace-nowrap text-[12px]"
            >
              PostHog products used
            </Text>
          </Tooltip>
          {products.map((product) => (
            <ResourceChip key={product.id} {...product} />
          ))}
        </Flex>
      </Box>
    </Box>
  );
}
