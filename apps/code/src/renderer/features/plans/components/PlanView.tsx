import {
  baseComponents,
  MarkdownRenderer,
} from "@features/editor/components/MarkdownRenderer";
import { DEFAULT_TAB_IDS } from "@features/panels/constants/panelConstants";
import { usePanelLayoutStore } from "@features/panels/store/panelLayoutStore";
import { findTabInTree } from "@features/panels/store/panelTree";
import {
  useConfigOptionForTask,
  usePendingPermissionsForTask,
} from "@features/sessions/hooks/useSession";
import { getSessionService } from "@features/sessions/service/service";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { CheckCircle, ListChecks, Warning, X } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Box, Flex, Select, Text } from "@radix-ui/themes";
import { trpc, trpcClient } from "@renderer/trpc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { logger } from "@utils/logger";
import { useCallback, useEffect, useMemo, useState } from "react";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { remarkPlanThreads } from "../remark/remarkPlanThreads";
import { usePlanAgentActivityStore } from "../stores/planAgentActivityStore";
import { extractThreadKeys } from "../utils/extractThreadKeys";
import { handlePlanDeletion } from "../utils/handlePlanDeletion";
import {
  buildPlanApprovalState,
  type PlanApprovalState,
} from "../utils/planApprovalPermission";
import {
  buildPlanImplementationPrompt,
  buildPlanRejectionPrompt,
} from "../utils/planPrompts";
import { PlanBlockGutter } from "./PlanBlockGutter";
import { PlanThread } from "./PlanThread";

const log = logger.scope("plan-view");

/** Switch the task's active tab to Chat (the default Logs tab). */
function activateChatTab(taskId: string): void {
  const { taskLayouts, setActiveTab } = usePanelLayoutStore.getState();
  const layout = taskLayouts[taskId];
  if (!layout) return;
  const result = findTabInTree(layout.panelTree, DEFAULT_TAB_IDS.LOGS);
  if (!result) return;
  setActiveTab(taskId, result.panelId, DEFAULT_TAB_IDS.LOGS);
}

interface PlanViewProps {
  taskId: string;
  filePath: string;
}

interface PlanThreadElementProps {
  "data-block-text"?: string;
  "data-occurrence"?: string | number;
  "data-messages"?: string;
  "data-resolved"?: string;
}

function parseOccurrence(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
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

interface PlanApprovalBarProps {
  taskId: string;
  state: PlanApprovalState;
}

function PlanApprovalBar({ taskId, state }: PlanApprovalBarProps) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState(
    state.defaultOptionId,
  );

  const selectedOption = useMemo(
    () =>
      state.approveOptions.find((o) => o.optionId === selectedOptionId) ??
      state.approveOptions[0],
    [state.approveOptions, selectedOptionId],
  );

  // Reject is always available: in permission flow it resolves the permission;
  // in mode flow it sends a feedback prompt to the agent (mode stays at plan).
  const canReject =
    state.source === "permission" ? state.rejectOptionId !== null : true;

  const handleApprove = useCallback(async () => {
    setPending("approve");
    try {
      if (state.source === "permission") {
        // Resolving the permission moves the agent out of plan mode and it
        // continues on its own — we just need to bring the user to Chat.
        await getSessionService().respondToPermission(
          taskId,
          state.toolCallId,
          selectedOption.optionId,
        );
      } else {
        // Mode-driven: the agent is idle in plan mode. Switch the mode,
        // then send a prompt telling it to start implementing.
        await getSessionService().setSessionConfigOption(
          taskId,
          "mode",
          selectedOption.optionId,
        );
        await getSessionService().sendPrompt(
          taskId,
          buildPlanImplementationPrompt(),
        );
      }
      activateChatTab(taskId);
    } catch (err) {
      log.warn("Failed to approve plan", { err });
    } finally {
      setPending(null);
    }
  }, [state, selectedOption.optionId, taskId]);

  const handleReject = useCallback(async () => {
    const trimmed = rejectReason.trim();
    setPending("reject");
    try {
      if (state.source === "permission") {
        if (!state.rejectOptionId) return;
        await getSessionService().respondToPermission(
          taskId,
          state.toolCallId,
          state.rejectOptionId,
          trimmed || undefined,
        );
      } else {
        // Mode-driven flow: send a prompt asking the agent to revise. Mode
        // stays at `plan` so the agent keeps iterating on the plan file.
        await getSessionService().sendPrompt(
          taskId,
          buildPlanRejectionPrompt(trimmed),
        );
      }
    } catch (err) {
      log.warn("Failed to reject plan", { err });
    } finally {
      setPending(null);
      setShowRejectInput(false);
      setRejectReason("");
    }
  }, [state, rejectReason, taskId]);

  return (
    <Box className="sticky top-0 z-10 border-(--gray-5) border-b bg-(--color-background) px-12 py-3">
      <Flex direction="column" gap="2">
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Text className="text-(--gray-11) text-sm">
            The agent is waiting for plan approval.
          </Text>
          <Flex gap="2" align="center">
            <Text className="text-(--gray-11) text-[13px]">Mode</Text>
            <Select.Root
              value={selectedOptionId}
              onValueChange={setSelectedOptionId}
              size="1"
              disabled={!!pending}
            >
              <Select.Trigger className="min-w-[200px]" />
              <Select.Content>
                {state.approveOptions.map((option) => (
                  <Select.Item key={option.optionId} value={option.optionId}>
                    {option.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            {canReject && (
              <Button
                size="sm"
                onClick={() => setShowRejectInput((v) => !v)}
                disabled={!!pending}
              >
                <X />
                Reject
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={handleApprove}
              disabled={!!pending}
            >
              <CheckCircle />
              {pending === "approve" ? "Approving…" : "Approve plan"}
            </Button>
          </Flex>
        </Flex>
        {selectedOption.isBypass && (
          <Flex align="center" gap="1" className="text-(--orange-11) text-xs">
            <Warning size={12} weight="fill" />
            <Text size="1">
              Bypass permissions allows the agent to run any tool without
              asking. Use with caution.
            </Text>
          </Flex>
        )}
        {showRejectInput && canReject && (
          <Flex direction="column" gap="2">
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Tell the agent what to do differently (optional)…"
              className="min-h-[60px] w-full resize-none rounded border border-(--gray-6) bg-(--color-background) p-2 text-(--gray-12) text-[13px] leading-normal outline-none"
            />
            <Flex gap="2">
              <Button
                size="sm"
                variant="primary"
                onClick={handleReject}
                disabled={!!pending}
              >
                {pending === "reject" ? "Sending…" : "Send rejection"}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setShowRejectInput(false);
                  setRejectReason("");
                }}
              >
                Cancel
              </Button>
            </Flex>
          </Flex>
        )}
      </Flex>
    </Box>
  );
}

export function PlanView({ taskId, filePath }: PlanViewProps) {
  const enabled = useSettingsStore((s) => s.planThreadsEnabled);

  if (!enabled) return <PlanViewDisabledPlaceholder />;
  return <PlanViewInner taskId={taskId} filePath={filePath} />;
}

function PlanViewDisabledPlaceholder() {
  return (
    <Flex
      align="center"
      justify="center"
      direction="column"
      gap="2"
      className="h-full px-8 text-center"
    >
      <ListChecks size={24} className="text-(--gray-10)" />
      <Text className="text-(--gray-11) text-sm">Plan view is disabled.</Text>
      <Text className="text-(--gray-10) text-xs">
        Enable it from Settings → General → Experimental.
      </Text>
    </Flex>
  );
}

function PlanViewInner({ taskId, filePath }: PlanViewProps) {
  const queryClient = useQueryClient();
  const planQuery = useQuery(
    trpc.plans.read.queryOptions({ filePath }, { staleTime: 0 }),
  );

  const pendingPermissions = usePendingPermissionsForTask(taskId);
  const modeOption = useConfigOptionForTask(taskId, "mode");
  const planApprovalState = useMemo(
    () =>
      buildPlanApprovalState({
        permissions: pendingPermissions,
        configOptions: modeOption ? [modeOption] : undefined,
      }),
    [pendingPermissions, modeOption],
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

  useSubscription(
    trpc.plans.onDeleted.subscriptionOptions(undefined, {
      onData: (payload) => {
        handlePlanDeletion({
          deletedPath: payload.filePath,
          currentPath: filePath,
          clearCache: () => {
            queryClient.setQueryData(trpc.plans.read.queryKey({ filePath }), {
              content: null,
            });
          },
          onCleared: () => {
            queryClient.invalidateQueries(
              trpc.plans.read.queryFilter({ filePath }),
            );
          },
        });
      },
    }),
  );

  const remarkPlugins = useMemo<PluggableList>(
    () => [remarkGfm, remarkPlanThreads],
    [],
  );

  // Garbage-collect the activity-store queue whenever the plan content
  // changes. Resolve-then-rewrite flows can remove a thread block
  // without ever posting an `[A]:` reply inside it, which would
  // otherwise leak the entry. Sweeping by "which thread keys still
  // exist in the file" is StrictMode-safe (no race with unmount).
  const syncActivityQueue = usePlanAgentActivityStore((s) => s.syncQueue);
  const planContent = planQuery.data?.content ?? null;
  useEffect(() => {
    if (planContent === null) return;
    syncActivityQueue(extractThreadKeys(planContent, filePath));
  }, [planContent, filePath, syncActivityQueue]);

  const components = useMemo(() => {
    const wrap = <Tag extends keyof typeof baseComponents>(tag: Tag) => {
      const Original = baseComponents[tag];
      return function Wrapped(props: Record<string, unknown>) {
        const blockText = props["data-plan-block"] as string | undefined;
        const occurrence = parseOccurrence(props["data-occurrence"]);
        const {
          "data-plan-block": _unusedBlock,
          "data-occurrence": _unusedOcc,
          ...rest
        } = props;
        return (
          <PlanBlockGutter
            blockText={blockText}
            occurrence={occurrence}
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

    // Wrap only the components whose mdast types are in
    // `remarkPlanThreads`'s `ANCHORABLE_TYPES`. The set must agree on
    // both sides — see the comment in `remarkPlanThreads.ts` for why
    // `code` / `table` are excluded.
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
      "plan-thread": (props: PlanThreadElementProps) => {
        const blockText = props["data-block-text"] ?? "";
        const occurrence = parseOccurrence(props["data-occurrence"]);
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
            occurrence={occurrence}
            messages={messages}
            resolved={resolved}
          />
        );
      },
    } as never;
  }, [filePath, taskId]);

  const content = planContent;

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
      {planApprovalState && (
        <PlanApprovalBar taskId={taskId} state={planApprovalState} />
      )}
      <Box className="plan-markdown mx-auto max-w-[820px] px-12 py-8 text-(--gray-12)">
        <MarkdownRenderer
          content={content}
          remarkPluginsOverride={remarkPlugins}
          componentsOverride={components}
        />
      </Box>
    </Box>
  );
}
