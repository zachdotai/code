import { FileText } from "@phosphor-icons/react";
import { Box } from "@radix-ui/themes";
import type {
  FileTile as FileTileType,
  GridSize,
} from "@shared/types/work-projects";
import { useCallback, useEffect, useState } from "react";
import { TileFrame } from "../TileFrame";

interface FileTileProps {
  tile: FileTileType;
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onResizePreview?: (size: GridSize | null) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  onUpdate?: (patch: { filename?: string; contents?: string }) => void;
}

export function FileTile({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onResizePreview,
  onApplyPending,
  onRejectPending,
  onUpdate,
}: FileTileProps) {
  const [filename, setFilename] = useState(tile.filename);
  const [contents, setContents] = useState(tile.contents);

  useEffect(() => setFilename(tile.filename), [tile.filename]);
  useEffect(() => setContents(tile.contents), [tile.contents]);

  const commitName = useCallback(() => {
    if (!onUpdate) return;
    const trimmed = filename.trim();
    if (!trimmed || trimmed === tile.filename) return;
    onUpdate({ filename: trimmed });
  }, [filename, tile.filename, onUpdate]);

  const commitContents = useCallback(() => {
    if (!onUpdate) return;
    if (contents === tile.contents) return;
    onUpdate({ contents });
  }, [contents, tile.contents, onUpdate]);

  return (
    <TileFrame
      tile={tile}
      icon={FileText}
      label="File"
      headerAction={
        <input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          readOnly={!onUpdate}
          className="block max-w-[180px] truncate rounded-(--radius-2) bg-transparent px-1.5 py-0.5 text-right font-mono text-(--gray-11) text-[11px] outline-none hover:bg-(--gray-3) focus:bg-(--gray-3) focus:text-(--gray-12)"
        />
      }
      currentGridSize={currentGridSize}
      onRemove={onRemove}
      onResizeGrid={onResizeGrid}
      onResizePreview={onResizePreview}
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
    >
      <Box className="flex h-full min-h-0 flex-col">
        <textarea
          value={contents}
          onChange={(e) => setContents(e.target.value)}
          onBlur={commitContents}
          readOnly={!onUpdate}
          placeholder="# New file"
          className="block min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-2 font-mono text-(--gray-12) text-[12px] leading-relaxed outline-none placeholder:text-(--gray-9)"
        />
      </Box>
    </TileFrame>
  );
}
