import { ArrowsClockwise, X } from "@phosphor-icons/react";
import { useHostTRPCClient } from "@posthog/host-router/react";
import type { PrDependencyView } from "@posthog/host-router/rts-schemas";
import { useFunSpeak } from "@posthog/ui/features/fun-mode/hooks/useFunSpeak";
import { logger } from "@posthog/ui/shell/logger";
import { Badge, Flex, IconButton, Text } from "@radix-ui/themes";
import { useState } from "react";
import { selectEdgesForNest, usePrGraphStore } from "../../stores/prGraphStore";

const log = logger.scope("nest-detail-panel");

interface PrGraphSectionProps {
  nestId: string;
}

export function PrGraphSection({ nestId }: PrGraphSectionProps) {
  const t = useFunSpeak();
  const edges = usePrGraphStore(selectEdgesForNest(nestId));
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const hostClient = useHostTRPCClient();

  const handleUnlink = async (edgeId: string) => {
    setUnlinkingId(edgeId);
    try {
      await hostClient.rts.prGraph.unlink.mutate({ id: edgeId });
    } catch (e) {
      log.error("Failed to unlink pr dependency", { edgeId, error: e });
    } finally {
      setUnlinkingId(null);
    }
  };

  if (edges.length === 0) return null;

  return (
    <div className="border-(--gray-5) border-t pt-4">
      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          {t("PR graph")}
        </Text>
        {edges.map((edge) => (
          <PrGraphEdgeRow
            key={edge.id}
            edge={edge}
            onUnlink={handleUnlink}
            disabled={unlinkingId === edge.id}
          />
        ))}
      </Flex>
    </div>
  );
}

function PrGraphEdgeRow({
  edge,
  onUnlink,
  disabled,
}: {
  edge: PrDependencyView;
  onUnlink: (edgeId: string) => void | Promise<void>;
  disabled: boolean;
}) {
  return (
    <Flex
      align="center"
      gap="2"
      className="rounded-(--radius-2) border border-(--gray-4) bg-(--gray-2) p-2"
    >
      <ArrowsClockwise size={12} className="text-(--gray-10)" />
      <Flex direction="column" gap="1" className="min-w-0 flex-1">
        <Text size="1" className="truncate font-mono text-(--gray-11)">
          {edge.parentTaskId.slice(0, 8)} → {edge.childTaskId.slice(0, 8)}
        </Text>
        <Text size="1" color="gray">
          updated {new Date(edge.updatedAt).toLocaleString()}
        </Text>
      </Flex>
      <PrGraphStateBadge state={edge.state} />
      <IconButton
        type="button"
        variant="ghost"
        color="gray"
        size="1"
        title="Unlink"
        disabled={disabled}
        onClick={() => onUnlink(edge.id)}
      >
        <X size={12} />
      </IconButton>
    </Flex>
  );
}

function PrGraphStateBadge({ state }: { state: PrDependencyView["state"] }) {
  const color: "amber" | "green" | "red" | "purple" = (() => {
    switch (state) {
      case "pending":
        return "amber";
      case "satisfied":
        return "green";
      case "broken":
        return "red";
      case "follow_up":
        return "purple";
    }
  })();
  return (
    <Badge color={color} size="1" variant="soft">
      {state}
    </Badge>
  );
}
