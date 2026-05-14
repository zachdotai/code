import {
  Check,
  DotsThree,
  type IconProps,
  TrashSimple,
  X,
} from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type { GridSize, Tile } from "@shared/types/work-projects";
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { TileResizeHandle } from "./TileResizeHandle";

/** Quick-pick presets for the tile options menu. Maps a human label to a
 *  canonical {cols, rows} so the user can jump to a known size without
 *  dragging. The corner drag handles arbitrary positions in between. */
const QUICK_SIZES: { label: string; size: GridSize }[] = [
  { label: "Small", size: { cols: 3, rows: 1 } },
  { label: "Medium", size: { cols: 6, rows: 2 } },
  { label: "Large", size: { cols: 8, rows: 2 } },
  { label: "Full width", size: { cols: 12, rows: 2 } },
];

interface TileFrameProps {
  tile: Tile;
  icon?: ComponentType<IconProps>;
  label?: string;
  /** Header right-side content (e.g. an "Open in PostHog" link). */
  headerAction?: ReactNode;
  children: ReactNode;
  /** The current effective gridSize (including any in-flight preview).
   *  Required when `onResizeGrid` is set so the handle knows the baseline. */
  currentGridSize?: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onResizePreview?: (size: GridSize | null) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  /** When true the frame omits its chrome (border, header, padding). Use for
   *  title tiles that own their own presentation. */
  bare?: boolean;
}

function isSameSize(a: GridSize, b: GridSize): boolean {
  return a.cols === b.cols && a.rows === b.rows;
}

export function TileFrame({
  tile,
  icon: Icon,
  label,
  headerAction,
  children,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onResizePreview,
  onApplyPending,
  onRejectPending,
  bare,
}: TileFrameProps) {
  const isPending = tile.state !== "live";
  const pendingLabel =
    tile.state === "pending_add"
      ? "Suggested by chat"
      : tile.state === "pending_remove"
        ? "Remove suggested"
        : tile.state === "pending_edit"
          ? "Edit suggested"
          : null;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  if (bare) {
    return (
      <Box
        className={`group relative ${isPending ? "rounded-(--radius-3) p-1 outline outline-dashed outline-(--accent-7) outline-2" : ""}`}
      >
        {pendingLabel && (
          <PendingBanner
            label={pendingLabel}
            onApply={onApplyPending}
            onReject={onRejectPending}
          />
        )}
        {children}
      </Box>
    );
  }

  return (
    <Box
      className={`group relative flex h-full min-w-0 flex-col overflow-hidden rounded-(--radius-3) border bg-(--gray-1) transition-colors duration-100 ${
        isPending
          ? "border-(--accent-7) border-dashed"
          : "border-(--gray-5) group-data-[resizing=true]/tile:border-(--accent-8) group-data-[resizing=true]/tile:ring-(--accent-7) group-data-[resizing=true]/tile:ring-1"
      }`}
    >
      {pendingLabel && (
        <PendingBanner
          label={pendingLabel}
          onApply={onApplyPending}
          onReject={onRejectPending}
        />
      )}
      {(label || headerAction || onRemove || onResizeGrid) && (
        <Flex
          align="center"
          justify="between"
          gap="2"
          className="shrink-0 border-(--gray-4) border-b px-3 py-2"
        >
          <Flex align="center" gap="2" className="min-w-0 text-(--gray-11)">
            {Icon && <Icon size={13} weight="duotone" />}
            {label && (
              <Text
                as="span"
                weight="medium"
                className="truncate text-(--gray-12) text-[12px]"
              >
                {label}
              </Text>
            )}
          </Flex>
          <Flex align="center" gap="2" className="shrink-0">
            {headerAction}
            {(onResizeGrid || onRemove) && (
              <Box className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen((v) => !v);
                  }}
                  aria-label="Tile options"
                  className="flex h-6 w-6 items-center justify-center rounded-(--radius-2) text-(--gray-10) opacity-0 transition-opacity hover:bg-(--gray-3) hover:text-(--gray-12) group-hover/tile:opacity-100"
                >
                  <DotsThree size={14} weight="bold" />
                </button>
                {menuOpen && (
                  <Box className="absolute top-7 right-0 z-10 w-44 overflow-hidden rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) shadow-lg">
                    {onResizeGrid && currentGridSize && (
                      <Box className="border-(--gray-4) border-b px-3 py-2">
                        <Text
                          as="div"
                          className="mb-1 text-(--gray-10) text-[10px] uppercase tracking-wide"
                        >
                          Size
                        </Text>
                        <Flex gap="1" wrap="wrap">
                          {QUICK_SIZES.map(({ label: l, size }) => {
                            const active = isSameSize(currentGridSize, size);
                            return (
                              <button
                                type="button"
                                key={l}
                                onClick={() => {
                                  onResizeGrid(size);
                                  setMenuOpen(false);
                                }}
                                className={`rounded-(--radius-2) border px-2 py-0.5 text-[11px] transition-colors ${
                                  active
                                    ? "border-(--gray-12) bg-(--gray-12) text-(--gray-1)"
                                    : "border-(--gray-5) bg-(--gray-1) text-(--gray-11) hover:border-(--gray-7) hover:text-(--gray-12)"
                                }`}
                              >
                                {l}
                              </button>
                            );
                          })}
                        </Flex>
                        <Text
                          as="div"
                          className="mt-1.5 text-(--gray-10) text-[10px]"
                        >
                          or drag the corner
                        </Text>
                      </Box>
                    )}
                    {onRemove && (
                      <button
                        type="button"
                        onClick={() => {
                          onRemove();
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--red-11) text-[12px] hover:bg-(--red-3)"
                      >
                        <TrashSimple size={12} weight="bold" />
                        Remove tile
                      </button>
                    )}
                  </Box>
                )}
              </Box>
            )}
          </Flex>
        </Flex>
      )}
      <Box className="min-h-0 flex-1 overflow-auto">{children}</Box>
      {onResizeGrid && currentGridSize && (
        <TileResizeHandle
          currentSize={currentGridSize}
          onResize={onResizeGrid}
          onPreview={onResizePreview}
        />
      )}
    </Box>
  );
}

function PendingBanner({
  label,
  onApply,
  onReject,
}: {
  label: string;
  onApply?: () => void;
  onReject?: () => void;
}) {
  return (
    <Flex
      align="center"
      justify="between"
      gap="2"
      className="shrink-0 border-(--accent-6) border-b bg-(--accent-2) px-3 py-1.5"
    >
      <Text
        as="span"
        weight="medium"
        className="text-(--accent-11) text-[11px] uppercase tracking-wide"
      >
        {label}
      </Text>
      <Flex gap="1">
        {onReject && (
          <button
            type="button"
            onClick={onReject}
            aria-label="Reject"
            className="flex h-5 w-5 items-center justify-center rounded-(--radius-2) text-(--gray-11) hover:bg-(--gray-4) hover:text-(--gray-12)"
          >
            <X size={11} weight="bold" />
          </button>
        )}
        {onApply && (
          <button
            type="button"
            onClick={onApply}
            aria-label="Accept"
            className="flex h-5 items-center gap-1 rounded-(--radius-2) bg-(--accent-9) px-2 text-(--accent-1) text-[11px] hover:bg-(--accent-10)"
          >
            <Check size={11} weight="bold" />
            Accept
          </button>
        )}
      </Flex>
    </Flex>
  );
}
