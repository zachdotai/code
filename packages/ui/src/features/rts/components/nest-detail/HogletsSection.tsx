import { Crosshair, SignOut, Trash, Warning } from "@phosphor-icons/react";
import { useHostTRPCClient } from "@posthog/host-router/react";
import type { Hoglet } from "@posthog/host-router/rts-schemas";
import { useFunSpeak } from "@posthog/ui/features/fun-mode/hooks/useFunSpeak";
import { logger } from "@posthog/ui/shell/logger";
import {
  AlertDialog,
  Badge,
  Button,
  Flex,
  IconButton,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { releaseHoglet } from "../../service/hogletMutations";
import {
  selectNestHoglets,
  selectTaskSummary,
  useHogletStore,
} from "../../stores/hogletStore";
import { STATUS_BADGE_COLOR, type TaskStatus } from "../hogletStatus";

const log = logger.scope("nest-detail-panel");

const HOGLET_STATUS_LABEL: Record<NonNullable<TaskStatus>, string> = {
  not_started: "Not started",
  queued: "Queued",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

interface HogletsSectionProps {
  nestId: string;
  onFocusHoglet?: (hogletId: string) => void;
  disabled: boolean;
}

export function HogletsSection({
  nestId,
  onFocusHoglet,
  disabled,
}: HogletsSectionProps) {
  const t = useFunSpeak();
  const hoglets = useHogletStore(selectNestHoglets(nestId));
  const ordered = useMemo<Hoglet[]>(
    () =>
      [...hoglets].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [hoglets],
  );

  return (
    <div className="flex flex-col gap-2 border-(--gray-5) border-t pt-3">
      <Flex align="center" justify="between" gap="2">
        <Text size="2" weight="medium">
          {t("Hoglets")}
        </Text>
        <Text size="1" color="gray">
          {ordered.length === 0
            ? t("None")
            : ordered.length === 1
              ? "1"
              : ordered.length}
        </Text>
      </Flex>
      {ordered.length === 0 ? (
        <Text size="1" color="gray">
          {t(
            "No hoglets yet. The hedgehog will spawn them, or drag a wild hoglet onto this nest.",
          )}
        </Text>
      ) : (
        <Flex direction="column" gap="1">
          {ordered.map((hoglet) => (
            <HogletCard
              key={hoglet.id}
              hoglet={hoglet}
              nestId={nestId}
              onFocus={onFocusHoglet}
              disabled={disabled}
            />
          ))}
        </Flex>
      )}
    </div>
  );
}

function HogletCard({
  hoglet,
  nestId,
  onFocus,
  disabled,
}: {
  hoglet: Hoglet;
  nestId: string;
  onFocus?: (hogletId: string) => void;
  disabled: boolean;
}) {
  const summary = useHogletStore(selectTaskSummary(hoglet.taskId));
  const status: NonNullable<TaskStatus> = (summary?.latest_run?.status ??
    "not_started") as NonNullable<TaskStatus>;
  const title = summary?.title ?? hoglet.taskId.slice(0, 12);
  const [releasing, setReleasing] = useState(false);
  const hostClient = useHostTRPCClient();
  const [retireDialogOpen, setRetireDialogOpen] = useState(false);
  const [retiring, setRetiring] = useState(false);

  const handleFocus = () => {
    if (onFocus) onFocus(hoglet.id);
  };

  const handleRelease = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (releasing) return;
    setReleasing(true);
    try {
      await releaseHoglet(hoglet.id, nestId);
    } finally {
      setReleasing(false);
    }
  };

  const handleRetire = async () => {
    if (retiring) return;
    setRetiring(true);
    try {
      await hostClient.rts.hoglets.retire.mutate({
        hogletId: hoglet.id,
      });
      useHogletStore.getState().remove(nestId, hoglet.id);
    } catch (error) {
      log.error("Failed to retire hoglet", {
        hogletId: hoglet.id,
        error,
      });
    } finally {
      setRetireDialogOpen(false);
      setRetiring(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-(--radius-2) border border-(--gray-4) bg-(--gray-a2) px-2 py-1.5 transition-colors hover:border-(--accent-7)">
      <button
        type="button"
        onClick={handleFocus}
        disabled={!onFocus}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left disabled:cursor-default"
        title={onFocus ? "Focus hoglet" : undefined}
      >
        <Text
          size="2"
          weight="medium"
          className="line-clamp-1 w-full text-(--gray-12)"
        >
          {title}
        </Text>
        <Flex align="center" gap="2">
          <Badge color={STATUS_BADGE_COLOR[status]} size="1" variant="soft">
            {HOGLET_STATUS_LABEL[status]}
          </Badge>
          {hoglet.signalReportId && (
            <Text size="1" color="gray">
              signal
            </Text>
          )}
        </Flex>
      </button>
      <Flex align="center" gap="1" className="shrink-0">
        {onFocus && (
          <Tooltip content="Focus on map" side="top">
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              onClick={handleFocus}
              disabled={disabled}
              aria-label="Focus hoglet"
            >
              <Crosshair size={12} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip content="Release to wild" side="top">
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={handleRelease}
            disabled={disabled || releasing}
            loading={releasing}
            aria-label="Release hoglet to wild"
          >
            <SignOut size={12} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Retire hoglet" side="top">
          <IconButton
            size="1"
            variant="ghost"
            color="red"
            onClick={() => setRetireDialogOpen(true)}
            disabled={disabled || retiring}
            aria-label="Retire hoglet"
          >
            <Trash size={12} />
          </IconButton>
        </Tooltip>
      </Flex>
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
                loading={retiring}
              >
                Retire
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  );
}
