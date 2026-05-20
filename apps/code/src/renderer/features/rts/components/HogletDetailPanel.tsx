import { CommandCenterSessionView } from "@features/command-center/components/CommandCenterSessionView";
import { archiveTaskImperative } from "@features/tasks/hooks/useArchiveTask";
import { useWorkspace } from "@features/workspace/hooks/useWorkspace";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import type { Hoglet } from "@main/services/rts/schemas";
import {
  ArrowSquareOut,
  ArrowsIn,
  ArrowsOut,
  CaretDown,
  ChatCircle,
  House,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import {
  AlertDialog,
  Badge,
  Button,
  Flex,
  IconButton,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import type { Task } from "@shared/types";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { useNavigationStore } from "@stores/navigationStore";
import { useQueryClient } from "@tanstack/react-query";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { WILD_BUCKET } from "../constants/buckets";
import { useHogletPositionStore } from "../stores/hogletPositionStore";
import { selectTaskSummary, useHogletStore } from "../stores/hogletStore";
import { wildHogletPosition } from "../utils/hogletPositions";
import { getHogletVisualPosition } from "../utils/hogletVisualPositions";
import { CommandConsole } from "./CommandConsole";
import { STATUS_BADGE_COLOR, type TaskStatus } from "./hogletStatus";

const log = logger.scope("hoglet-detail-panel");

function bucketKeyForHoglet(h: Hoglet): string {
  return h.nestId ?? WILD_BUCKET;
}

function retireSourceForHoglet(h: Hoglet): "wild" | "signal" | "nest" {
  if (h.nestId !== null) return "nest";
  if (h.signalReportId !== null) return "signal";
  return "wild";
}

interface HogletDetailPanelProps {
  hoglet: Hoglet;
  onClose: () => void;
}

const STATUS_LABEL: Record<NonNullable<TaskStatus>, string> = {
  not_started: "Not started",
  queued: "Queued",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function HogletDetailPanel({ hoglet, onClose }: HogletDetailPanelProps) {
  const summary = useHogletStore(selectTaskSummary(hoglet.taskId));
  const navigateToTask = useNavigationStore((s) => s.navigateToTask);
  const clearPosition = useHogletPositionStore((s) => s.clearPosition);
  const hasOverride = useHogletPositionStore(
    (s) => s.positions[hoglet.id] !== undefined,
  );
  const queryClient = useQueryClient();
  const trpcReact = useTRPC();
  const workspace = useWorkspace(hoglet.taskId);
  const ensuredCloudWorkspaceForRun = useRef<string | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [retireDialogOpen, setRetireDialogOpen] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [cloudWorkspaceError, setCloudWorkspaceError] = useState(false);

  const taskQuery = useAuthenticatedQuery<Task>(
    ["tasks", "detail", hoglet.taskId],
    (client) => client.getTask(hoglet.taskId) as unknown as Promise<Task>,
    { staleTime: 30_000 },
  );
  const summaryUpdatedAt = summary?.updated_at ?? null;
  const detailUpdatedAt = taskQuery.data?.updated_at ?? null;
  const latestRun = taskQuery.data?.latest_run ?? null;
  const latestRunId = latestRun?.id ?? null;
  const cloudWorkspaceNeeded =
    latestRun?.environment === "cloud" && workspace?.mode !== "cloud";

  useEffect(() => {
    if (!summaryUpdatedAt || summaryUpdatedAt === detailUpdatedAt) {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: ["tasks", "detail", hoglet.taskId],
    });
  }, [detailUpdatedAt, hoglet.taskId, queryClient, summaryUpdatedAt]);

  useEffect(() => {
    if (
      !cloudWorkspaceNeeded ||
      !latestRunId ||
      ensuredCloudWorkspaceForRun.current === latestRunId
    ) {
      return;
    }

    let cancelled = false;
    ensuredCloudWorkspaceForRun.current = latestRunId;
    setCloudWorkspaceError(false);

    trpcClient.workspace.create
      .mutate({
        taskId: hoglet.taskId,
        mainRepoPath: "",
        folderId: "",
        folderPath: "",
        mode: "cloud",
        branch: latestRun.branch ?? undefined,
      })
      .then(() =>
        queryClient.invalidateQueries(trpcReact.workspace.getAll.pathFilter()),
      )
      .catch((error) => {
        log.error("Failed to ensure cloud workspace for hoglet", {
          taskId: hoglet.taskId,
          taskRunId: latestRunId,
          error,
        });
        if (!cancelled) {
          ensuredCloudWorkspaceForRun.current = null;
          setCloudWorkspaceError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    cloudWorkspaceNeeded,
    hoglet.taskId,
    latestRun?.branch,
    latestRunId,
    queryClient,
    trpcReact.workspace.getAll,
  ]);

  const status: NonNullable<TaskStatus> = (summary?.latest_run?.status ??
    "not_started") as NonNullable<TaskStatus>;
  const title = summary?.title ?? hoglet.taskId.slice(0, 8);
  const origin = hoglet.nestId ? "Nested" : "Wild";
  const provenance = hoglet.signalReportId
    ? "Signal-backed"
    : "Operator-spawned";
  const createdAt = summary?.created_at ?? hoglet.createdAt;
  const updatedAt = summary?.updated_at ?? hoglet.updatedAt;

  const handleOpenInEditor = () => {
    if (taskQuery.data) navigateToTask(taskQuery.data);
  };

  const handleRetire = async () => {
    if (retiring) return;
    setRetiring(true);

    const bucketKey = bucketKeyForHoglet(hoglet);
    const store = useHogletStore.getState();
    const original = store.byBucket[bucketKey]?.find((h) => h.id === hoglet.id);

    const visualPos = getHogletVisualPosition(hoglet.id);
    const posOverride = useHogletPositionStore.getState().positions[hoglet.id];
    const pos = visualPos ?? posOverride ?? wildHogletPosition(hoglet.id);
    store.startDying(hoglet.id, pos.x, pos.y);
    store.remove(bucketKey, hoglet.id);
    clearPosition(hoglet.id);
    setRetireDialogOpen(false);
    onClose();

    try {
      await trpcClient.rts.hoglets.retire.mutate({
        hogletId: hoglet.id,
      });
      track(ANALYTICS_EVENTS.RTS_HOGLET_RETIRED, {
        source: retireSourceForHoglet(hoglet),
      });
      await archiveTaskImperative(hoglet.taskId, queryClient, {
        skipNavigate: true,
      });
    } catch (error) {
      log.error("Failed to retire hoglet", { hogletId: hoglet.id, error });
      if (original) {
        useHogletStore.getState().finalizeDeath(hoglet.id);
        useHogletStore.getState().upsert(bucketKey, original);
      }
      toast.error("Could not retire hoglet");
    } finally {
      setRetiring(false);
    }
  };

  const description = taskQuery.data?.description?.trim() ?? "";

  useHotkeys("c", () => setChatOpen((v) => !v));
  useHotkeys("e", () => {
    if (chatOpen) setExpanded((v) => !v);
  }, [chatOpen]);
  useHotkeys("o", () => {
    if (taskQuery.data) handleOpenInEditor();
  }, [taskQuery.data, handleOpenInEditor]);
  useHotkeys("h", () => {
    if (hasOverride) clearPosition(hoglet.id);
  }, [hasOverride, clearPosition, hoglet.id]);
  useHotkeys("r", () => {
    if (!retiring) setRetireDialogOpen(true);
  }, [retiring]);

  const panelHeight = chatOpen
    ? expanded
      ? "min(92vh, 880px)"
      : "min(60vh, 540px)"
    : undefined;
  const panelWidth =
    chatOpen && expanded ? "min(1100px, calc(100vw - 1.5rem))" : undefined;

  return (
    <CommandConsole
      consoleKey={hoglet.id}
      size="wide"
      width={panelWidth}
      style={{ height: panelHeight }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenuCapture={(e) => e.stopPropagation()}
    >
      <CommandConsole.Header
        eyebrow={
          <span className="flex items-center gap-2">
            Hoglet
            <Badge color={STATUS_BADGE_COLOR[status]} size="1" variant="soft">
              {STATUS_LABEL[status]}
            </Badge>
            <Badge color="gray" size="1" variant="surface">
              {origin}
            </Badge>
            <Badge color="gray" size="1" variant="surface">
              {provenance}
            </Badge>
          </span>
        }
        title={title}
        subtitle={`${summary?.repository ?? "No repository"} · updated ${new Date(updatedAt).toLocaleString()}`}
        onClose={onClose}
        trailing={
          <>
            {hasOverride && (
              <Tooltip
                content="Return hoglet to its default spot (H)"
                side="top"
              >
                <IconButton
                  size="1"
                  variant="soft"
                  color="gray"
                  onClick={() => clearPosition(hoglet.id)}
                  aria-label="Send to default position"
                >
                  <House size={14} />
                </IconButton>
              </Tooltip>
            )}
            {chatOpen && (
              <Tooltip
                content={expanded ? "Shrink panel (E)" : "Expand panel (E)"}
                side="top"
              >
                <IconButton
                  size="1"
                  variant="soft"
                  color="gray"
                  onClick={() => setExpanded((v) => !v)}
                  aria-label={expanded ? "Shrink panel" : "Expand panel"}
                >
                  {expanded ? <ArrowsIn size={14} /> : <ArrowsOut size={14} />}
                </IconButton>
              </Tooltip>
            )}
            <Tooltip content="Open task in editor (O)" side="top">
              <IconButton
                size="1"
                variant="soft"
                color="gray"
                onClick={handleOpenInEditor}
                aria-label="Open task in editor"
              >
                <ArrowSquareOut size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip content="Retire hoglet (R)" side="top">
              <IconButton
                size="1"
                variant="soft"
                color="red"
                onClick={() => setRetireDialogOpen(true)}
                disabled={retiring}
                aria-label="Retire hoglet"
              >
                <Trash size={14} />
              </IconButton>
            </Tooltip>
          </>
        }
      />

      {chatOpen ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-(--accent-a5) border-b bg-(--gray-a2) px-3 py-1.5">
            <Text size="1" color="gray" weight="medium">
              Conversation
            </Text>
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              title="Collapse chat (C)"
              className="flex items-center gap-1 rounded-(--radius-2) px-2 py-0.5 text-(--gray-11) text-[11px] hover:bg-(--accent-a3) hover:text-(--accent-12)"
            >
              <CaretDown size={12} />
              Collapse
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {taskQuery.data && !cloudWorkspaceNeeded ? (
              <CommandCenterSessionView
                taskId={hoglet.taskId}
                task={taskQuery.data}
                isActiveSession
              />
            ) : (
              <div className="flex h-full items-center justify-center text-(--gray-10) text-[12px]">
                {cloudWorkspaceError
                  ? "Could not prepare cloud session"
                  : taskQuery.isError
                    ? "Could not load task"
                    : "Loading conversation…"}
              </div>
            )}
          </div>
        </div>
      ) : (
        <CommandConsole.Body>
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="group flex flex-col gap-1.5 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-a2) p-3 text-left transition-colors hover:border-(--accent-7) hover:bg-(--accent-a3)"
          >
            <div className="flex items-center justify-between gap-2">
              <Text
                size="1"
                weight="medium"
                className="text-(--gray-10) uppercase tracking-wide group-hover:text-(--accent-11)"
              >
                Conversation summary
              </Text>
              <span className="flex items-center gap-1 text-(--gray-10) text-[11px] group-hover:text-(--accent-11)">
                <ChatCircle size={12} />
                Open chat (C)
              </span>
            </div>
            {taskQuery.isLoading && !description ? (
              <Text size="2" className="text-(--gray-10)">
                Loading task details…
              </Text>
            ) : description ? (
              <Text
                size="2"
                className="line-clamp-3 whitespace-pre-wrap text-(--gray-12)"
              >
                {description}
              </Text>
            ) : (
              <Text size="2" className="text-(--gray-10)">
                {taskQuery.isError
                  ? "Could not load task description."
                  : "No description recorded for this task."}
              </Text>
            )}
          </button>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-(--gray-10) text-[11px]">
            <span className="font-mono">{hoglet.taskId.slice(0, 12)}</span>
            <span>
              Created {new Date(createdAt).toLocaleDateString()} ·{" "}
              {new Date(createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {hoglet.affinityScore !== null && (
              <span>Affinity {hoglet.affinityScore.toFixed(2)}</span>
            )}
          </div>
        </CommandConsole.Body>
      )}

      <AlertDialog.Root
        open={retireDialogOpen}
        onOpenChange={setRetireDialogOpen}
      >
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>
            <Flex align="center" gap="2">
              <Warning size={18} weight="fill" color="var(--red-9)" />
              <Text className="font-bold">Retire this hoglet?</Text>
            </Flex>
          </AlertDialog.Title>
          <AlertDialog.Description className="text-sm">
            <Text>
              The hoglet will be removed from the map. The underlying task is
              not deleted and can still be opened from your task list.
            </Text>
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="solid"
                color="red"
                onClick={handleRetire}
                disabled={retiring}
              >
                Retire
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </CommandConsole>
  );
}
