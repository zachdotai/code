import type {
  GridSize,
  ProjectIconId,
  ProjectMember,
  Tile,
} from "@shared/types/work-projects";
import { ArtifactTile } from "./tiles/ArtifactTile";
import { FileTile } from "./tiles/FileTile";
import { HeadlineTile } from "./tiles/HeadlineTile";
import { InsightTile } from "./tiles/InsightTile";
import { NoteTile } from "./tiles/NoteTile";
import { SkillOutputTile } from "./tiles/SkillOutputTile";
import { TitleTile } from "./tiles/TitleTile";

interface TileRendererProps {
  tile: Tile;
  members: ProjectMember[];
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onResizePreview?: (size: GridSize | null) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  onUpdateTitleTile?: (patch: {
    name?: string;
    tagline?: string;
    iconId?: ProjectIconId;
  }) => void;
  onUpdateNoteTile?: (patch: {
    body?: string;
    tone?: "yellow" | "blue" | "green" | "pink" | "neutral";
  }) => void;
  onUpdateFileTile?: (patch: { filename?: string; contents?: string }) => void;
  onUpdateChecklistItems?: (
    items: Array<{ text: string; done: boolean }>,
  ) => void;
}

export function TileRenderer({
  tile,
  members,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onResizePreview,
  onApplyPending,
  onRejectPending,
  onUpdateTitleTile,
  onUpdateNoteTile,
  onUpdateFileTile,
  onUpdateChecklistItems,
}: TileRendererProps) {
  switch (tile.type) {
    case "title":
      return (
        <TitleTile
          tile={tile}
          members={members}
          onApplyPending={onApplyPending}
          onRejectPending={onRejectPending}
          onUpdate={onUpdateTitleTile}
        />
      );
    case "headline":
      return (
        <HeadlineTile
          tile={tile}
          currentGridSize={currentGridSize}
          onRemove={onRemove}
          onResizeGrid={onResizeGrid}
          onResizePreview={onResizePreview}
          onApplyPending={onApplyPending}
          onRejectPending={onRejectPending}
        />
      );
    case "insight":
      return (
        <InsightTile
          tile={tile}
          currentGridSize={currentGridSize}
          onRemove={onRemove}
          onResizeGrid={onResizeGrid}
          onResizePreview={onResizePreview}
          onApplyPending={onApplyPending}
          onRejectPending={onRejectPending}
        />
      );
    case "file":
      return (
        <FileTile
          tile={tile}
          currentGridSize={currentGridSize}
          onRemove={onRemove}
          onResizeGrid={onResizeGrid}
          onResizePreview={onResizePreview}
          onApplyPending={onApplyPending}
          onRejectPending={onRejectPending}
          onUpdate={onUpdateFileTile}
        />
      );
    case "skill_output":
      return (
        <SkillOutputTile
          tile={tile}
          currentGridSize={currentGridSize}
          onRemove={onRemove}
          onResizeGrid={onResizeGrid}
          onResizePreview={onResizePreview}
          onApplyPending={onApplyPending}
          onRejectPending={onRejectPending}
        />
      );
    case "note":
      return (
        <NoteTile
          tile={tile}
          currentGridSize={currentGridSize}
          onRemove={onRemove}
          onResizeGrid={onResizeGrid}
          onResizePreview={onResizePreview}
          onApplyPending={onApplyPending}
          onRejectPending={onRejectPending}
          onUpdate={onUpdateNoteTile}
        />
      );
    case "artifact":
      return (
        <ArtifactTile
          tile={tile}
          currentGridSize={currentGridSize}
          onRemove={onRemove}
          onResizeGrid={onResizeGrid}
          onResizePreview={onResizePreview}
          onApplyPending={onApplyPending}
          onRejectPending={onRejectPending}
          onUpdateChecklistItems={onUpdateChecklistItems}
        />
      );
  }
}
