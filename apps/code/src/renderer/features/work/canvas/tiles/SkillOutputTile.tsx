import { Lightbulb } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type {
  GridSize,
  SkillOutputTile as SkillOutputTileType,
} from "@shared/types/work-projects";
import { TileFrame } from "../TileFrame";

interface SkillOutputTileProps {
  tile: SkillOutputTileType;
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onResizePreview?: (size: GridSize | null) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
}

function formatLastRun(iso?: string): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SkillOutputTile({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onResizePreview,
  onApplyPending,
  onRejectPending,
}: SkillOutputTileProps) {
  const lastRun = formatLastRun(tile.lastRunAt);

  return (
    <TileFrame
      tile={tile}
      icon={Lightbulb}
      label={tile.skillName}
      headerAction={
        lastRun ? (
          <Text as="span" className="text-(--gray-10) text-[11px]">
            Ran {lastRun}
          </Text>
        ) : undefined
      }
      currentGridSize={currentGridSize}
      onRemove={onRemove}
      onResizeGrid={onResizeGrid}
      onResizePreview={onResizePreview}
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
    >
      <Box className="px-4 py-3">
        <Flex direction="column" gap="2">
          {tile.skillDescription && (
            <Text
              as="div"
              className="text-(--gray-11) text-[11px] leading-snug"
            >
              {tile.skillDescription}
            </Text>
          )}
          {tile.lastRunOutput ? (
            <Text
              as="div"
              className="whitespace-pre-wrap text-(--gray-12) text-[12px] leading-snug"
            >
              {tile.lastRunOutput}
            </Text>
          ) : (
            <Text
              as="div"
              className="text-(--gray-10) text-[12px] italic leading-snug"
            >
              No runs yet. Ask the chat to run this skill against the project.
            </Text>
          )}
        </Flex>
      </Box>
    </TileFrame>
  );
}
