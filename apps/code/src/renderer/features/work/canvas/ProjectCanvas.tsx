import { PointerSensor } from "@dnd-kit/dom";
import type { DragDropEvents } from "@dnd-kit/react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { FileText, GaugeIcon, NoteIcon } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type {
  GridSize,
  NewTileInput,
  ProjectIconId,
  ProjectMember,
  Tile,
} from "@shared/types/work-projects";
import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { AddTileMenu } from "./AddTileMenu";
import { CanvasGridContext, type CanvasGridMetrics } from "./CanvasGridContext";
import { resolveGridSize } from "./grid-utils";
import { TileRenderer } from "./TileRenderer";

/** Grid layout constants. Row height is fixed so `row-span-N` is predictable
 *  across tile types. Gap matches the existing `gap-3` (12px) class. */
const ROW_HEIGHT_PX = 140;
const GAP_PX = 12;

interface ProjectCanvasProps {
  projectId: string;
  tiles: Tile[];
  members: ProjectMember[];
  onAddTile: (tile: NewTileInput) => Promise<void>;
  onRemoveTile: (tileId: string) => Promise<void>;
  onResizeTileGrid: (tileId: string, size: GridSize) => Promise<void>;
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
  onUpdateChecklistItems: (
    tileId: string,
    items: Array<{ text: string; done: boolean }>,
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
    transition: { duration: 160, easing: "ease-out" },
  });

  return (
    <Box
      ref={ref}
      data-dragging={isDragging ? "true" : undefined}
      // `cursor-grab` reads as a drag affordance on the tile chrome (header,
      // border, padding); textareas/inputs/buttons inside naturally override
      // with their own cursors so this doesn't fight text editing.
      className="group/sortable relative h-full min-w-0 cursor-grab transition-[transform,box-shadow] duration-100 data-[dragging=true]:z-20 data-[dragging=true]:scale-[1.015] data-[dragging=true]:cursor-grabbing data-[dragging=true]:opacity-90 data-[dragging=true]:shadow-lg data-[dragging=true]:ring-(--accent-7) data-[dragging=true]:ring-1"
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
  onResizeTileGrid,
  onMoveTile,
  onApplyPending,
  onRejectPending,
  onUpdateTitleTile,
  onUpdateNoteTile,
  onUpdateFileTile,
  onUpdateChecklistItems,
}: ProjectCanvasProps) {
  // Title tile is data-only — the project header renders the project's name,
  // icon, tagline, and members. Filter it out of the canvas so we don't
  // double-render.
  const renderedTiles = useMemo(
    () => tiles.filter((t) => t.type !== "title"),
    [tiles],
  );

  // Per-tile in-flight resize preview. Keyed by tile id; cleared on release.
  // Stored as React state so the affected tile re-renders with the preview
  // span classes mid-drag without committing to the server.
  const [previewById, setPreviewById] = useState<Record<string, GridSize>>({});

  // True while ANY tile is being resized (corner-drag). Used to suppress
  // framer-motion's per-tile `layout` animation during the drag — otherwise
  // every cell-tick triggers a 120ms layout animation on every neighbor and
  // the canvas wobbles. The user wants snap-feedback.
  const isResizing = Object.keys(previewById).length > 0;

  const gridRef = useRef<HTMLElement | null>(null);

  const measure = useCallback((): CanvasGridMetrics | null => {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const totalGap = GAP_PX * 11; // gaps between 12 cols
    const cellWidth = (rect.width - totalGap) / 12;
    return { cols: 12, cellWidth, cellHeight: ROW_HEIGHT_PX, gap: GAP_PX };
  }, []);

  const gridContextValue = useMemo(() => ({ measure, gridRef }), [measure]);

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
    <CanvasGridContext.Provider value={gridContextValue}>
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
              <Box
                ref={(el) => {
                  gridRef.current = el;
                }}
                className="grid grid-cols-12 gap-3"
                style={{
                  gridAutoRows: `${ROW_HEIGHT_PX}px`,
                  // Dense packing: smaller tiles backfill gaps left when
                  // larger tiles wrap to the next row. Keeps the bento
                  // grid feeling solid, not sparse.
                  gridAutoFlow: "row dense",
                }}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  {renderedTiles.map((tile, index) => {
                    const effectiveSize =
                      previewById[tile.id] ?? resolveGridSize(tile);
                    const spanClass = spanClassFor(effectiveSize);
                    const isThisResizing = !!previewById[tile.id];
                    return (
                      <motion.div
                        key={tile.id}
                        // Skip framer-motion's layout animation while a resize
                        // is in flight (anywhere on the canvas) — otherwise
                        // every cell-tick triggers a layout dance on every
                        // neighbor and the canvas wobbles. CSS grid handles
                        // the snap instantly; that's what the user wants.
                        layout={isResizing ? false : "position"}
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.92 }}
                        transition={{
                          duration: 0.14,
                          ease: [0.32, 0.72, 0, 1],
                        }}
                        data-resizing={isThisResizing ? "true" : undefined}
                        className={`${spanClass} group/tile relative min-w-0`}
                      >
                        <SortableTile id={tile.id} index={index}>
                          <TileRenderer
                            tile={tile}
                            members={members}
                            currentGridSize={effectiveSize}
                            onRemove={() => {
                              void onRemoveTile(tile.id);
                            }}
                            onResizeGrid={(next) => {
                              void onResizeTileGrid(tile.id, next);
                            }}
                            onResizePreview={(next) => {
                              setPreviewById((prev) => {
                                if (next === null) {
                                  if (!(tile.id in prev)) return prev;
                                  const { [tile.id]: _drop, ...rest } = prev;
                                  return rest;
                                }
                                return { ...prev, [tile.id]: next };
                              });
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
                            onUpdateChecklistItems={(items) => {
                              void onUpdateChecklistItems(tile.id, items);
                            }}
                          />
                        </SortableTile>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </Box>
            </DragDropProvider>
          )}
        </Flex>
      </Box>
    </CanvasGridContext.Provider>
  );
}

function spanClassFor(size: GridSize): string {
  // Import-free local helper that mirrors grid-utils.spanClasses. We pull
  // the same Tailwind class strings.
  // biome-ignore lint/style/noNonNullAssertion: clamp keeps lookups in range
  const col = colSpan(size.cols)!;
  // biome-ignore lint/style/noNonNullAssertion: clamp keeps lookups in range
  const row = rowSpan(size.rows)!;
  return `${col} ${row}`;
}

function colSpan(n: number): string {
  const c = Math.max(1, Math.min(12, n));
  return COL_SPANS[c - 1];
}

function rowSpan(n: number): string {
  const r = Math.max(1, Math.min(4, n));
  return ROW_SPANS[r - 1];
}

// Tailwind needs these class names to appear as literals at build time.
const COL_SPANS = [
  "col-span-1",
  "col-span-2",
  "col-span-3",
  "col-span-4",
  "col-span-5",
  "col-span-6",
  "col-span-7",
  "col-span-8",
  "col-span-9",
  "col-span-10",
  "col-span-11",
  "col-span-12",
];

const ROW_SPANS = ["row-span-1", "row-span-2", "row-span-3", "row-span-4"];

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
