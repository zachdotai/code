import { NoteIcon } from "@phosphor-icons/react";
import { Box, Flex } from "@radix-ui/themes";
import type {
  GridSize,
  NoteTile as NoteTileType,
} from "@shared/types/work-projects";
import { useCallback, useEffect, useRef, useState } from "react";
import { TileFrame } from "../TileFrame";

type NoteTone = NonNullable<NoteTileType["tone"]>;

const TONE_STRIPE: Record<NoteTone, string> = {
  yellow: "bg-(--yellow-9)",
  blue: "bg-(--blue-9)",
  green: "bg-(--green-9)",
  pink: "bg-(--pink-9)",
  neutral: "bg-(--gray-7)",
};

const TONE_SOFT_BG: Record<NoteTone, string> = {
  yellow: "bg-(--yellow-2)",
  blue: "bg-(--blue-2)",
  green: "bg-(--green-2)",
  pink: "bg-(--pink-2)",
  neutral: "bg-(--gray-2)",
};

const TONE_LABEL: Record<NoteTone, string> = {
  yellow: "Yellow",
  blue: "Blue",
  green: "Green",
  pink: "Pink",
  neutral: "Neutral",
};

const TONE_ORDER: NoteTone[] = ["yellow", "blue", "green", "pink", "neutral"];

interface NoteTileProps {
  tile: NoteTileType;
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onResizePreview?: (size: GridSize | null) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  onUpdate?: (patch: { body?: string; tone?: NoteTone }) => void;
}

export function NoteTile({
  tile,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onResizePreview,
  onApplyPending,
  onRejectPending,
  onUpdate,
}: NoteTileProps) {
  const tone: NoteTone = tile.tone ?? "yellow";
  const [value, setValue] = useState(tile.body);
  const [tonePickerOpen, setTonePickerOpen] = useState(false);
  const toneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setValue(tile.body);
  }, [tile.body]);

  useEffect(() => {
    if (!tonePickerOpen) return;
    const handle = (e: MouseEvent) => {
      if (toneRef.current && !toneRef.current.contains(e.target as Node)) {
        setTonePickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [tonePickerOpen]);

  const commit = useCallback(() => {
    if (!onUpdate) return;
    if (value === tile.body) return;
    onUpdate({ body: value });
  }, [value, tile.body, onUpdate]);

  const headerAction = onUpdate ? (
    <Box className="relative" ref={toneRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setTonePickerOpen((v) => !v);
        }}
        title="Change tone"
        aria-label="Change tone"
        className={`h-4 w-4 rounded-full border border-(--gray-5) transition-transform hover:scale-110 ${TONE_STRIPE[tone]}`}
      />
      {tonePickerOpen && (
        <Flex
          align="center"
          gap="1"
          className="absolute top-6 right-0 z-20 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) p-1.5 shadow-lg"
        >
          {TONE_ORDER.map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => {
                onUpdate({ tone: t });
                setTonePickerOpen(false);
              }}
              title={TONE_LABEL[t]}
              aria-label={TONE_LABEL[t]}
              className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${TONE_STRIPE[t]} ${
                t === tone
                  ? "border-(--gray-12) ring-(--gray-12) ring-1"
                  : "border-(--gray-5)"
              }`}
            />
          ))}
        </Flex>
      )}
    </Box>
  ) : undefined;

  return (
    <TileFrame
      tile={tile}
      icon={NoteIcon}
      label="Note"
      headerAction={headerAction}
      currentGridSize={currentGridSize}
      onRemove={onRemove}
      onResizeGrid={onResizeGrid}
      onResizePreview={onResizePreview}
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
    >
      <Flex className={`h-full min-h-0 ${TONE_SOFT_BG[tone]}`}>
        <Box className={`w-[3px] shrink-0 ${TONE_STRIPE[tone]}`} />
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          placeholder="Capture a thought…"
          className="block h-full min-h-0 w-full resize-none bg-transparent px-3 py-2 text-(--gray-12) text-[13px] leading-snug outline-none placeholder:text-(--gray-9)"
          readOnly={!onUpdate}
        />
      </Flex>
    </TileFrame>
  );
}
