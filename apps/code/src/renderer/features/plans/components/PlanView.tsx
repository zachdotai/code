import {
  baseComponents,
  MarkdownRenderer,
} from "@features/editor/components/MarkdownRenderer";
import { ListChecks } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { trpc, trpcClient } from "@renderer/trpc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { logger } from "@utils/logger";
import { useEffect, useMemo } from "react";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { remarkPlanThreads } from "../remark/remarkPlanThreads";
import { PlanBlockGutter } from "./PlanBlockGutter";
import { PlanComposePopover } from "./PlanComposePopover";
import { PlanThread } from "./PlanThread";

const log = logger.scope("plan-view");

interface PlanViewProps {
  taskId: string;
  filePath: string;
}

interface PlanThreadElementProps {
  "data-block-text"?: string;
  "data-messages"?: string;
  "data-resolved"?: string;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "plan-thread": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & PlanThreadElementProps,
        HTMLElement
      >;
    }
  }
}

export function PlanView({ taskId, filePath }: PlanViewProps) {
  const queryClient = useQueryClient();
  const planQuery = useQuery(
    trpc.plans.read.queryOptions({ filePath }, { staleTime: 0 }),
  );

  useEffect(() => {
    void trpcClient.plans.ensureWatching.mutate().catch((err) => {
      log.warn("Failed to ensure plans watcher started", { err });
    });
  }, []);

  useSubscription(
    trpc.plans.onChanged.subscriptionOptions(undefined, {
      onData: (payload) => {
        if (payload.filePath === filePath) {
          queryClient.invalidateQueries(
            trpc.plans.read.queryFilter({ filePath }),
          );
        }
      },
    }),
  );

  const remarkPlugins = useMemo<PluggableList>(
    () => [remarkGfm, remarkPlanThreads],
    [],
  );

  const components = useMemo(() => {
    const wrap = <Tag extends keyof typeof baseComponents>(tag: Tag) => {
      const Original = baseComponents[tag];
      return function Wrapped(props: Record<string, unknown>) {
        const blockText = props["data-plan-block"] as string | undefined;
        const { "data-plan-block": _unused, ...rest } = props;
        return (
          <PlanBlockGutter
            blockText={blockText}
            filePath={filePath}
            taskId={taskId}
          >
            {Original
              ? (Original as (p: unknown) => React.ReactNode)(rest)
              : null}
          </PlanBlockGutter>
        );
      };
    };

    return {
      h1: wrap("h1"),
      h2: wrap("h2"),
      h3: wrap("h3"),
      h4: wrap("h4"),
      h5: wrap("h5"),
      h6: wrap("h6"),
      p: wrap("p"),
      ul: wrap("ul"),
      ol: wrap("ol"),
      pre: wrap("pre"),
      "plan-thread": (props: PlanThreadElementProps) => {
        const blockText = props["data-block-text"] ?? "";
        const messages = (() => {
          try {
            return JSON.parse(props["data-messages"] ?? "[]");
          } catch {
            return [];
          }
        })();
        const resolved = props["data-resolved"] === "true";
        return (
          <PlanThread
            filePath={filePath}
            taskId={taskId}
            blockText={blockText}
            messages={messages}
            resolved={resolved}
          />
        );
      },
    } as never;
  }, [filePath, taskId]);

  const content = planQuery.data?.content ?? null;

  if (planQuery.isLoading && content === null) {
    return (
      <Flex align="center" justify="center" className="h-full">
        <Text className="text-(--gray-10) text-sm">Loading plan…</Text>
      </Flex>
    );
  }

  if (!content) {
    return (
      <Flex
        align="center"
        justify="center"
        className="h-full"
        direction="column"
        gap="2"
      >
        <ListChecks size={24} className="text-(--gray-10)" />
        <Text className="text-(--gray-10) text-sm">No plan to display.</Text>
      </Flex>
    );
  }

  return (
    <Box className="relative h-full overflow-y-auto">
      <Box className="plan-markdown mx-auto max-w-[820px] px-12 py-8 text-(--gray-12)">
        <MarkdownRenderer
          content={content}
          remarkPluginsOverride={remarkPlugins}
          componentsOverride={components}
        />
      </Box>
      <PlanComposePopover />
    </Box>
  );
}
