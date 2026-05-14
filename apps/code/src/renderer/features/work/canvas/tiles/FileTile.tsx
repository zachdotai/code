import {
  ArrowSquareOut,
  FileText,
  Folder,
  Plus,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { trpcClient, useTRPC } from "@renderer/trpc";
import { toast } from "@renderer/utils/toast";
import type {
  FileListItem,
  FileTile as FileTileType,
  GridSize,
} from "@shared/types/work-projects";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { TileFrame } from "../TileFrame";

interface FileTileProps {
  tile: FileTileType;
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  onUpdate?: (patch: {
    title?: string;
    items?: FileListItem[];
  }) => Promise<void>;
}

function formatBytes(size: number | null): string {
  if (size === null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function tildeify(parentDir: string, homeDir: string | null): string {
  if (!homeDir) return parentDir;
  if (parentDir === homeDir) return "~";
  if (parentDir.startsWith(`${homeDir}/`)) {
    return `~${parentDir.slice(homeDir.length)}`;
  }
  return parentDir;
}

export function FileTile({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onApplyPending,
  onRejectPending,
  onUpdate,
}: FileTileProps) {
  const trpc = useTRPC();
  const [adding, setAdding] = useState(false);

  // Defensive: persisted tiles from older builds may not have `items` yet.
  // The main-process migration backfills it, but a stale optimistic cache or
  // a tile crossing a build boundary can briefly land here without it.
  const items = useMemo(
    () => (Array.isArray(tile.items) ? tile.items : []),
    [tile.items],
  );
  const paths = useMemo(() => items.map((i) => i.path), [items]);

  const statsQuery = useQuery({
    ...trpc.os.statFiles.queryOptions({ paths }),
    enabled: paths.length > 0,
    staleTime: 30_000,
  });
  const homeQuery = useQuery(trpc.os.getHomeDir.queryOptions());

  const statByPath = useMemo(() => {
    const map = new Map<string, NonNullable<typeof statsQuery.data>[number]>();
    for (const s of statsQuery.data ?? []) map.set(s.path, s);
    return map;
  }, [statsQuery.data]);

  const handleAdd = async () => {
    if (!onUpdate || adding) return;
    setAdding(true);
    try {
      const picked = await trpcClient.os.selectFiles.query();
      if (picked.length === 0) return;
      const now = new Date().toISOString();
      const existing = new Set(items.map((i) => i.path));
      const newItems: FileListItem[] = picked
        .filter((p: string) => !existing.has(p))
        .map((p: string) => ({ path: p, addedAt: now }));
      if (newItems.length === 0) return;
      await onUpdate({ items: [...items, ...newItems] });
    } catch (err) {
      toast.error("Add file failed", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (path: string) => {
    if (!onUpdate) return;
    await onUpdate({ items: items.filter((i) => i.path !== path) });
  };

  const handleOpen = async (path: string) => {
    try {
      const result = await trpcClient.os.openFile.mutate({ filePath: path });
      if (!result.ok && result.error) {
        toast.error("Couldn't open file", { description: result.error });
      }
    } catch (err) {
      toast.error("Couldn't open file", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    }
  };

  const headerAction = onUpdate ? (
    <button
      type="button"
      onClick={handleAdd}
      disabled={adding}
      title="Add files"
      aria-label="Add files"
      className="flex h-6 items-center gap-1 rounded-(--radius-2) px-1.5 text-(--gray-11) text-[11px] hover:bg-(--gray-3) hover:text-(--gray-12) disabled:opacity-50"
    >
      <Plus size={11} weight="bold" />
      Add
    </button>
  ) : undefined;

  return (
    <TileFrame
      tile={tile}
      icon={FileText}
      label={tile.title || "Files"}
      headerAction={headerAction}
      currentGridSize={currentGridSize}
      onRemove={onRemove}
      onResizeGrid={onResizeGrid}
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
    >
      <Box className="h-full min-h-0 overflow-y-auto">
        {items.length === 0 ? (
          <Flex
            direction="column"
            align="center"
            justify="center"
            gap="2"
            className="h-full px-4 py-6 text-center"
          >
            <Folder size={22} weight="duotone" className="text-(--gray-9)" />
            <Text
              as="div"
              className="max-w-[240px] text-(--gray-10) text-[12px] leading-snug"
            >
              No files yet. Add files from your computer to keep references
              handy here.
            </Text>
            {onUpdate && (
              <button
                type="button"
                onClick={handleAdd}
                disabled={adding}
                className="mt-1 flex items-center gap-1.5 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-3 py-1.5 text-(--gray-11) text-[12px] hover:border-(--gray-7) hover:text-(--gray-12) disabled:opacity-50"
              >
                <Plus size={11} weight="bold" />
                Pick files…
              </button>
            )}
          </Flex>
        ) : (
          <Flex direction="column">
            {items.map((item) => {
              const stat = statByPath.get(item.path);
              const missing = stat && !stat.exists;
              const name =
                stat?.name ?? item.path.split("/").pop() ?? item.path;
              const parent =
                stat?.parentDir ??
                item.path.slice(0, item.path.lastIndexOf("/"));
              const displayParent = tildeify(parent, homeQuery.data ?? null);
              const sizeText = formatBytes(stat?.size ?? null);

              return (
                <Flex
                  key={item.path}
                  align="center"
                  gap="2"
                  className="group/file-row border-(--gray-3) border-b px-3 py-1.5 last:border-b-0 hover:bg-(--gray-2)"
                >
                  <Box className="shrink-0 text-(--gray-11)">
                    {missing ? (
                      <WarningCircle
                        size={13}
                        weight="duotone"
                        className="text-(--red-10)"
                      />
                    ) : stat?.isDirectory ? (
                      <Folder size={13} weight="duotone" />
                    ) : (
                      <FileText size={13} weight="duotone" />
                    )}
                  </Box>
                  <button
                    type="button"
                    onClick={() => {
                      void handleOpen(item.path);
                    }}
                    title={item.path}
                    className="flex min-w-0 flex-1 flex-col items-start gap-0 text-left"
                  >
                    <Text
                      as="span"
                      className={`truncate text-[12px] leading-tight ${
                        missing
                          ? "text-(--red-11) line-through"
                          : "text-(--gray-12)"
                      }`}
                    >
                      {name}
                    </Text>
                    <Flex
                      align="center"
                      gap="2"
                      className="min-w-0 text-(--gray-10) text-[11px] leading-snug"
                    >
                      <Text as="span" className="truncate">
                        {displayParent}
                      </Text>
                      {sizeText && (
                        <Text as="span" className="shrink-0">
                          · {sizeText}
                        </Text>
                      )}
                      {missing && (
                        <Text as="span" className="shrink-0 text-(--red-11)">
                          · missing
                        </Text>
                      )}
                    </Flex>
                  </button>
                  <Flex
                    align="center"
                    gap="1"
                    className="shrink-0 opacity-0 transition-opacity group-hover/file-row:opacity-100"
                  >
                    {!missing && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleOpen(item.path);
                        }}
                        title="Open"
                        aria-label="Open"
                        className="flex h-5 w-5 items-center justify-center rounded-(--radius-2) text-(--gray-11) hover:bg-(--gray-3) hover:text-(--gray-12)"
                      >
                        <ArrowSquareOut size={11} weight="duotone" />
                      </button>
                    )}
                    {onUpdate && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleRemove(item.path);
                        }}
                        title="Remove from list"
                        aria-label="Remove from list"
                        className="flex h-5 w-5 items-center justify-center rounded-(--radius-2) text-(--gray-11) hover:bg-(--gray-3) hover:text-(--red-11)"
                      >
                        <X size={11} weight="bold" />
                      </button>
                    )}
                  </Flex>
                </Flex>
              );
            })}
          </Flex>
        )}
      </Box>
    </TileFrame>
  );
}
