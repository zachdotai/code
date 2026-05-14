import { PointerSensor } from "@dnd-kit/dom";
import type { DragDropEvents } from "@dnd-kit/react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { FileText, GaugeIcon, NoteIcon } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type {
  NewTileInput,
  ProjectIconId,
  ProjectMember,
  Tile,
  TileSize,
} from "@shared/types/work-projects";
import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useCallback, useMemo } from "react";
import { AddTileMenu } from "./AddTileMenu";
import { SIZE_TO_COLSPAN } from "./TileFrame";
import { TileRenderer } from "./TileRenderer";

interface ProjectCanvasProps {
  projectId: string;
  tiles: Tile[];
  members: ProjectMember[];
  onAddTile: (tile: NewTileInput) => Promise<void>;
  onRemoveTile: (tileId: string) => Promise<void>;
  onResizeTile: (tileId: string, size: TileSize) => Promise<void>;
  onMoveTile: (tileId: string, toIndex: number) => Promise<void>;
  onApplyPending: (tileId: string) => Promise<void>;
  onRejectPending: (tileId: string) => Promise<void>;
  onUpdateTitleTile: (patch: {
    name?: string;
    tagline?: string;
    iconId?: ProjectIconId;
  }) => Promise<void>;
  onUpdateNoteTile: (
    tileId: string,
    patch: {
      body?: string;
      tone?: "yellow" | "blue" | "green" | "pink" | "neutral";
    },
  ) => Promise<void>;
  onUpdateFileTile: (
    tileId: string,
    patch: { filename?: string; contents?: string },
  ) => Promise<void>;
}

function SortableTile({
  id,
  index,
  children,
}: {
  id: string;
  index: number;
  children: ReactNode;
}) {
  const { ref, isDragging } = useSortable({
    id,
    index,
    group: "project-canvas-tiles",
    transition: { duration: 200, easing: "ease" },
  });

  return (
    <Box
      ref={ref}
      className="min-w-0"
      style={{
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? "grabbing" : undefined,
      }}
    >
      {children}
    </Box>
  );
}

export function ProjectCanvas({
  tiles,
  members,
  onAddTile,
  onRemoveTile,
  onResizeTile,
  onMoveTile,
  onApplyPending,
  onRejectPending,
  onUpdateTitleTile,
  onUpdateNoteTile,
  onUpdateFileTile,
}: ProjectCanvasProps) {
  // Title tile is data-only — the project header renders the project's name,
  // icon, tagline, and members. Filter it out of the canvas so we don't
  // double-render.
  const renderedTiles = useMemo(
    () => tiles.filter((t) => t.type !== "title"),
    [tiles],
  );

  // Only fire the actual reorder on drop, NOT on every dragover. dnd-kit's
  // sortable still gives smooth visual feedback during drag via CSS transforms;
  // we only persist the move once the user commits.
  const handleDragEnd: DragDropEvents["dragend"] = useCallback(
    (event) => {
      const sourceId = event.operation.source?.id;
      const targetId = event.operation.target?.id;
      if (!sourceId || !targetId || sourceId === targetId) return;
      const targetIndex = tiles.findIndex((t) => t.id === String(targetId));
      if (targetIndex < 0) return;
      void onMoveTile(String(sourceId), targetIndex);
    },
    [tiles, onMoveTile],
  );

  return (
    <Box className="scrollbar-overlay-y h-full w-full overflow-y-auto">
      <Flex
        direction="column"
        gap="4"
        className="mx-auto w-full max-w-[1000px] px-6 pt-6 pb-12"
      >
        <Flex align="center" justify="end" className="-mb-1">
          <AddTileMenu
            onAdd={(tile) => {
              void onAddTile(tile);
            }}
          />
        </Flex>
        {renderedTiles.length === 0 ? (
          <EmptyState onAdd={onAddTile} />
        ) : (
          <DragDropProvider
            onDragEnd={handleDragEnd}
            sensors={[
              {
                plugin: PointerSensor,
                options: {
                  activationConstraints: { distance: { value: 6 } },
                },
              },
            ]}
          >
            <Box className="grid auto-rows-min grid-cols-12 gap-3">
              <AnimatePresence mode="popLayout" initial={false}>
                {renderedTiles.map((tile, index) => (
                  <motion.div
                    key={tile.id}
                    layout="position"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.92 }}
                    transition={{
                      duration: 0.18,
                      ease: [0.32, 0.72, 0, 1],
                    }}
                    className={`${SIZE_TO_COLSPAN[tile.size]} min-w-0`}
                  >
                    <SortableTile id={tile.id} index={index}>
                      <TileRenderer
                        tile={tile}
                        members={members}
                        onRemove={() => {
                          void onRemoveTile(tile.id);
                        }}
                        onResize={(size) => {
                          void onResizeTile(tile.id, size);
                        }}
                        onApplyPending={
                          tile.state !== "live"
                            ? () => {
                                void onApplyPending(tile.id);
                              }
                            : undefined
                        }
                        onRejectPending={
                          tile.state !== "live"
                            ? () => {
                                void onRejectPending(tile.id);
                              }
                            : undefined
                        }
                        onUpdateTitleTile={(patch) => {
                          void onUpdateTitleTile(patch);
                        }}
                        onUpdateNoteTile={(patch) => {
                          void onUpdateNoteTile(tile.id, patch);
                        }}
                        onUpdateFileTile={(patch) => {
                          void onUpdateFileTile(tile.id, patch);
                        }}
                      />
                    </SortableTile>
                  </motion.div>
                ))}
              </AnimatePresence>
            </Box>
          </DragDropProvider>
        )}
      </Flex>
    </Box>
  );
}

function EmptyState({
  onAdd,
}: {
  onAdd: (tile: NewTileInput) => Promise<void>;
}) {
  const starters: {
    label: string;
    description: string;
    icon: typeof NoteIcon;
    factory: () => NewTileInput;
  }[] = [
    {
      label: "A note",
      description: "Capture the goal or first thought.",
      icon: NoteIcon,
      factory: () => ({ type: "note", body: "", tone: "yellow", size: "md" }),
    },
    {
      label: "A metric",
      description: "Pin a number with a sparkline.",
      icon: GaugeIcon,
      factory: () => ({
        type: "headline",
        label: "Headline metric",
        fallbackValue: "—",
        fallbackDelta: "Set a target",
        fallbackSparkline: [0, 0, 0, 0, 0],
        size: "md",
      }),
    },
    {
      label: "A file",
      description: "Draft a doc the team can edit.",
      icon: FileText,
      factory: () => ({
        type: "file",
        filename: "untitled.md",
        contents: "# New file\n",
        size: "md",
      }),
    },
  ];

  return (
    <Flex
      direction="column"
      align="center"
      gap="4"
      className="rounded-(--radius-3) border border-(--gray-5) border-dashed bg-(--gray-1) px-6 py-12"
    >
      <Flex direction="column" align="center" gap="1">
        <Text as="div" weight="medium" className="text-(--gray-12) text-[14px]">
          A blank canvas
        </Text>
        <Text
          as="div"
          className="max-w-[440px] text-center text-(--gray-11) text-[12px]"
        >
          Drop in a starter tile below, or ask the chat on the right to set this
          project up.
        </Text>
      </Flex>
      <Flex align="stretch" justify="center" gap="2" wrap="wrap">
        {starters.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => {
                void onAdd(s.factory());
              }}
              className="flex w-[160px] flex-col items-start gap-1.5 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) px-3 py-2.5 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2)"
            >
              <Box className="text-(--gray-11)">
                <Icon size={16} weight="duotone" />
              </Box>
              <Text
                as="div"
                weight="medium"
                className="text-(--gray-12) text-[13px]"
              >
                {s.label}
              </Text>
              <Text
                as="div"
                className="text-(--gray-11) text-[11px] leading-snug"
              >
                {s.description}
              </Text>
            </button>
          );
        })}
      </Flex>
    </Flex>
  );
}
