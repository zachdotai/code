import { FileText, GaugeIcon, NoteIcon } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type {
  GithubActivityType,
  GridSize,
  NewTileInput,
  ProjectIconId,
  ProjectMember,
  Tile,
} from "@shared/types/work-projects";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GridLayout, type Layout } from "react-grid-layout";
import { AddTileMenu } from "./AddTileMenu";
import { resolveGridSize } from "./grid-utils";
import { packTilesToLayout } from "./packLayout";
import { TileRenderer } from "./TileRenderer";

/** Grid constants. 12 columns matches the existing tile-sizing model. Row
 *  height + margin reproduce the visual rhythm of the previous CSS grid. */
const COLS = 12;
const ROW_HEIGHT = 140;
const MARGIN: [number, number] = [12, 12];
const CONTAINER_PADDING: [number, number] = [0, 0];

/** Selector for elements inside a tile that should NOT initiate a drag.
 *  Lets the user click into inputs, buttons, links, and editable surfaces
 *  without dragging the tile. The tile's chrome (border, header, padding)
 *  is outside this selector so drag-from-chrome still works. */
const DRAG_CANCEL_SELECTOR =
  'textarea, input, select, button, a, [contenteditable="true"], .rgl-no-drag';

interface ProjectCanvasProps {
  projectId: string;
  tiles: Tile[];
  members: ProjectMember[];
  onAddTile: (tile: NewTileInput) => Promise<void>;
  onRemoveTile: (tileId: string) => Promise<void>;
  onResizeTileGrid: (tileId: string, size: GridSize) => Promise<void>;
  onUpdateTileLayout: (
    items: Array<{
      tileId: string;
      cols: number;
      rows: number;
      x: number;
      y: number;
    }>,
  ) => Promise<void>;
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
  onUpdateGithubActivityTile: (
    tileId: string,
    patch: {
      repo?: { owner: string; name: string };
      enabledTypes?: GithubActivityType[];
      windowDays?: number;
    },
  ) => Promise<void>;
  onRefreshGithubActivityTile: (tileId: string) => Promise<void>;
  onUpdateHeadlineTile: (
    tileId: string,
    patch: {
      label?: string;
      liveLabel?: string;
      query?: { posthogProjectId: number; body: Record<string, unknown> };
      posthogUrl?: string;
      fallbackValue?: string;
      fallbackDelta?: string;
      fallbackSparkline?: number[];
    },
  ) => Promise<void>;
  onClearHeadlineTileQuery: (tileId: string) => Promise<void>;
}

export function ProjectCanvas({
  tiles,
  members,
  onAddTile,
  onRemoveTile,
  onResizeTileGrid,
  onUpdateTileLayout,
  onApplyPending,
  onRejectPending,
  onUpdateTitleTile,
  onUpdateNoteTile,
  onUpdateFileTile,
  onUpdateChecklistItems,
  onUpdateGithubActivityTile,
  onRefreshGithubActivityTile,
  onUpdateHeadlineTile,
  onClearHeadlineTileQuery,
}: ProjectCanvasProps) {
  // Title tile is data-only – the project header renders the project's name,
  // icon, tagline, and members. Filter it out of the canvas so we don't
  // double-render.
  const renderedTiles = useMemo(
    () => tiles.filter((t) => t.type !== "title"),
    [tiles],
  );

  // Measure container width so RGL knows the pixel size of one grid column.
  // Resizes (e.g. user drags the chat panel's left edge) flow through via
  // ResizeObserver.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && Number.isFinite(w)) setWidth(w);
    });
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  // Layout is derived from tile state on every render. Tiles with a saved
  // `gridPosition` keep it; new tiles are packed into the next free slot
  // by `packTilesToLayout`.
  const layout = useMemo(
    () => packTilesToLayout(renderedTiles),
    [renderedTiles],
  );

  // Persist any layout that diverges from the saved state. RGL calls this
  // on initial mount and after every drag/resize. We diff against current
  // tile data and skip the no-op case so the cache doesn't churn.
  const handleLayoutChange = useCallback(
    (nextLayout: Layout) => {
      const changed: Array<{
        tileId: string;
        cols: number;
        rows: number;
        x: number;
        y: number;
      }> = [];
      for (const item of nextLayout) {
        const tile = renderedTiles.find((t) => t.id === item.i);
        if (!tile) continue;
        const size = resolveGridSize(tile);
        const pos = tile.gridPosition;
        const same =
          size.cols === item.w &&
          size.rows === item.h &&
          pos?.x === item.x &&
          pos?.y === item.y;
        if (!same) {
          changed.push({
            tileId: item.i,
            x: item.x,
            y: item.y,
            cols: item.w,
            rows: item.h,
          });
        }
      }
      if (changed.length > 0) {
        void onUpdateTileLayout(changed);
      }
    },
    [renderedTiles, onUpdateTileLayout],
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
          <Box ref={containerRef} className="project-canvas-grid w-full">
            {width > 0 && (
              <GridLayout
                layout={layout}
                width={width}
                gridConfig={{
                  cols: COLS,
                  rowHeight: ROW_HEIGHT,
                  margin: MARGIN,
                  containerPadding: CONTAINER_PADDING,
                  maxRows: Number.POSITIVE_INFINITY,
                }}
                resizeConfig={{
                  enabled: true,
                  handles: ["se"],
                }}
                dragConfig={{
                  enabled: true,
                  bounded: false,
                  cancel: DRAG_CANCEL_SELECTOR,
                  threshold: 3,
                }}
                onLayoutChange={handleLayoutChange}
                autoSize
              >
                {renderedTiles.map((tile) => {
                  const effectiveSize = resolveGridSize(tile);
                  return (
                    <div
                      key={tile.id}
                      className="group/tile min-w-0 cursor-grab"
                    >
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
                        onUpdateGithubActivityTile={async (patch) => {
                          await onUpdateGithubActivityTile(tile.id, patch);
                        }}
                        onUpdateHeadlineTile={async (patch) => {
                          await onUpdateHeadlineTile(tile.id, patch);
                        }}
                        onClearHeadlineTileQuery={async () => {
                          await onClearHeadlineTileQuery(tile.id);
                        }}
                        onRefreshGithubActivityTile={async () => {
                          await onRefreshGithubActivityTile(tile.id);
                        }}
                      />
                    </div>
                  );
                })}
              </GridLayout>
            )}
          </Box>
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
        fallbackValue: "–",
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
