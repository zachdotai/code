import type {
  Bridge,
  BridgeKind,
  Overlap,
  OverlapKind,
} from "@main/services/hedgemony/schemas";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { Badge, Button, Flex, Text } from "@radix-ui/themes";
import { logger } from "@utils/logger";
import { useState } from "react";
import { useFederation } from "../../hooks/useFederation";
import { selectNests, useNestStore } from "../../stores/nestStore";
import { formatRelativeTime } from "./relativeTime";

const log = logger.scope("federation-subsection");

interface FederationSubsectionProps {
  nestId: string;
}

/**
 * Per-nest Federation subsection — collapsed by default. Surfaces active
 * overlaps with sibling nests and outbound bridges originating from this
 * nest. Empty states for both sublists keep the panel from looking broken
 * when nothing is happening across the federation.
 */
export function FederationSubsection({ nestId }: FederationSubsectionProps) {
  const [open, setOpen] = useState(false);
  const { overlapsForNest, bridgesForNest, removeBridge } = useFederation({
    scopeNestId: nestId,
  });
  const nests = useNestStore(selectNests);
  const nameById = new Map(nests.map((n) => [n.id, n.name] as const));

  const outboundBridges = bridgesForNest.filter((b) => b.nestAId === nestId);

  const handleRemoveBridge = async (id: string) => {
    try {
      await removeBridge(id);
    } catch (error) {
      log.error("Failed to remove bridge from panel", { id, error });
    }
  };

  return (
    <div className="flex flex-col gap-2 border-(--gray-5) border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-left text-(--gray-12) hover:text-(--accent-11)"
        aria-expanded={open}
      >
        {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
        <Text size="2" weight="medium">
          Federation
        </Text>
        <Text size="1" color="gray">
          {overlapsForNest.length + outboundBridges.length === 0
            ? "no activity"
            : `${overlapsForNest.length} overlap${overlapsForNest.length === 1 ? "" : "s"} · ${outboundBridges.length} bridge${outboundBridges.length === 1 ? "" : "s"}`}
        </Text>
      </button>

      {open && (
        <Flex direction="column" gap="3" className="pl-4">
          <OverlapList
            overlaps={overlapsForNest}
            nestId={nestId}
            nameById={nameById}
          />
          <OutboundBridgeList
            bridges={outboundBridges}
            nameById={nameById}
            onRemove={handleRemoveBridge}
          />
        </Flex>
      )}
    </div>
  );
}

interface OverlapListProps {
  overlaps: Overlap[];
  nestId: string;
  nameById: Map<string, string>;
}

function OverlapList({ overlaps, nestId, nameById }: OverlapListProps) {
  return (
    <Flex direction="column" gap="1.5">
      <Text size="1" color="gray" weight="medium">
        Active overlaps with sibling nests
      </Text>
      {overlaps.length === 0 ? (
        <Text size="1" color="gray">
          No active overlaps.
        </Text>
      ) : (
        overlaps.map((overlap) => (
          <OverlapRow
            key={overlap.id}
            overlap={overlap}
            siblingName={
              nameById.get(
                overlap.nestAId === nestId ? overlap.nestBId : overlap.nestAId,
              ) ?? "Unknown nest"
            }
          />
        ))
      )}
    </Flex>
  );
}

const OVERLAP_KIND_LABEL: Record<OverlapKind, string> = {
  goal_embedding: "goal overlap",
  pr_graph: "PR graph",
  signal_runnerup: "signal collision",
  scratchpad: "scratchpad drift",
  chat_xref: "chat cross-ref",
};

const OVERLAP_KIND_COLOR: Record<
  OverlapKind,
  "violet" | "amber" | "cyan" | "blue" | "gray"
> = {
  goal_embedding: "violet",
  pr_graph: "amber",
  chat_xref: "cyan",
  signal_runnerup: "blue",
  scratchpad: "gray",
};

function OverlapRow({
  overlap,
  siblingName,
}: {
  overlap: Overlap;
  siblingName: string;
}) {
  return (
    <Flex
      align="center"
      gap="2"
      className="rounded-(--radius-2) border border-(--gray-4) bg-(--gray-a2) px-2 py-1.5"
    >
      <Flex direction="column" gap="0.5" className="min-w-0 flex-1">
        <Text size="2" weight="medium" className="truncate text-(--gray-12)">
          {siblingName}
        </Text>
        <Flex align="center" gap="2">
          <Badge
            size="1"
            variant="soft"
            color={OVERLAP_KIND_COLOR[overlap.kind]}
          >
            {OVERLAP_KIND_LABEL[overlap.kind]}
          </Badge>
          <Text size="1" color="gray">
            score {overlap.score.toFixed(2)}
          </Text>
          <Text size="1" color="gray">
            {formatRelativeTime(overlap.lastSeenAt)}
          </Text>
        </Flex>
      </Flex>
    </Flex>
  );
}

interface OutboundBridgeListProps {
  bridges: Bridge[];
  nameById: Map<string, string>;
  onRemove: (id: string) => void | Promise<void>;
}

function OutboundBridgeList({
  bridges,
  nameById,
  onRemove,
}: OutboundBridgeListProps) {
  return (
    <Flex direction="column" gap="1.5">
      <Text size="1" color="gray" weight="medium">
        Outbound bridges
      </Text>
      {bridges.length === 0 ? (
        <Text size="1" color="gray">
          No outbound bridges.
        </Text>
      ) : (
        bridges.map((bridge) => (
          <BridgeRow
            key={bridge.id}
            bridge={bridge}
            targetName={nameById.get(bridge.nestBId) ?? "Unknown nest"}
            onRemove={onRemove}
          />
        ))
      )}
    </Flex>
  );
}

const BRIDGE_KIND_LABEL: Record<BridgeKind, string> = {
  signal_forward: "signal forward",
  scratchpad_ref: "scratchpad ref",
  pr_dep: "PR dependency",
  shared_doc: "shared doc",
};

function BridgeRow({
  bridge,
  targetName,
  onRemove,
}: {
  bridge: Bridge;
  targetName: string;
  onRemove: (id: string) => void | Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    if (removing) return;
    setRemoving(true);
    try {
      await onRemove(bridge.id);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Flex
      align="center"
      gap="2"
      className="rounded-(--radius-2) border border-(--gray-4) bg-(--gray-a2) px-2 py-1.5"
    >
      <Flex direction="column" gap="0.5" className="min-w-0 flex-1">
        <Text size="2" weight="medium" className="truncate text-(--gray-12)">
          {targetName}
        </Text>
        <Flex align="center" gap="2">
          <Badge size="1" variant="soft" color="gray">
            {BRIDGE_KIND_LABEL[bridge.kind]}
          </Badge>
          <Text size="1" color="gray">
            by {bridge.createdBy}
          </Text>
        </Flex>
      </Flex>
      <Button
        variant="ghost"
        color="gray"
        size="1"
        onClick={handleRemove}
        disabled={removing}
        loading={removing}
        aria-label={`Remove bridge to ${targetName}`}
      >
        Remove
      </Button>
    </Flex>
  );
}
