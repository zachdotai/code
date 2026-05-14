import { Check, DotsThree } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type {
  ProjectIconId,
  ProjectMember,
  TitleTile as TitleTileType,
} from "@shared/types/work-projects";
import { useCallback, useEffect, useRef, useState } from "react";
import { PROJECT_ICON_MAP, PROJECT_ICON_OPTIONS } from "../icons";
import { TileFrame } from "../TileFrame";

interface TitleTileProps {
  tile: TitleTileType;
  members: ProjectMember[];
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  onUpdate?: (patch: {
    name?: string;
    tagline?: string;
    iconId?: ProjectIconId;
  }) => void;
}

export function TitleTile({
  tile,
  members,
  onApplyPending,
  onRejectPending,
  onUpdate,
}: TitleTileProps) {
  const Icon = PROJECT_ICON_MAP[tile.iconId] ?? PROJECT_ICON_MAP.lightbulb;
  const [isEditing, setIsEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(tile.name);
  const [taglineDraft, setTaglineDraft] = useState(tile.tagline);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setNameDraft(tile.name);
    setTaglineDraft(tile.tagline);
  }, [tile.name, tile.tagline]);

  useEffect(() => {
    if (!iconPickerOpen) return;
    const handle = (e: MouseEvent) => {
      if (iconRef.current && !iconRef.current.contains(e.target as Node)) {
        setIconPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [iconPickerOpen]);

  const startEditing = useCallback(() => {
    setNameDraft(tile.name);
    setTaglineDraft(tile.tagline);
    setIsEditing(true);
  }, [tile.name, tile.tagline]);

  const commit = useCallback(() => {
    const trimmedName = nameDraft.trim();
    const trimmedTagline = taglineDraft.trim();
    const patch: Parameters<NonNullable<TitleTileProps["onUpdate"]>>[0] = {};
    if (trimmedName && trimmedName !== tile.name) patch.name = trimmedName;
    if (trimmedTagline !== tile.tagline) patch.tagline = trimmedTagline;
    if (onUpdate && Object.keys(patch).length > 0) onUpdate(patch);
    setIsEditing(false);
  }, [nameDraft, taglineDraft, tile, onUpdate]);

  const cancel = useCallback(() => {
    setNameDraft(tile.name);
    setTaglineDraft(tile.tagline);
    setIsEditing(false);
  }, [tile.name, tile.tagline]);

  return (
    <TileFrame
      tile={tile}
      bare
      onApplyPending={onApplyPending}
      onRejectPending={onRejectPending}
    >
      <Flex align="start" justify="between" gap="3">
        <Flex align="center" gap="3" className="min-w-0">
          <Box ref={iconRef} className="relative">
            <button
              type="button"
              onClick={() => onUpdate && setIconPickerOpen((v) => !v)}
              disabled={!onUpdate}
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-(--radius-2) bg-(--gray-3) text-(--gray-11) ${
                onUpdate ? "hover:bg-(--gray-4)" : ""
              }`}
              aria-label="Change icon"
            >
              <Icon size={26} weight="regular" />
            </button>
            {iconPickerOpen && (
              <Box className="absolute top-14 left-0 z-10 grid grid-cols-5 gap-1.5 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) p-2 shadow-lg">
                {PROJECT_ICON_OPTIONS.map((id) => {
                  const Opt = PROJECT_ICON_MAP[id];
                  return (
                    <button
                      type="button"
                      key={id}
                      onClick={() => {
                        onUpdate?.({ iconId: id });
                        setIconPickerOpen(false);
                      }}
                      aria-label={`Use ${id} icon`}
                      className={`flex h-8 w-8 items-center justify-center rounded-(--radius-2) text-(--gray-11) transition-colors hover:bg-(--gray-3) hover:text-(--gray-12) ${
                        id === tile.iconId
                          ? "bg-(--gray-3) text-(--gray-12) ring-(--gray-7) ring-1"
                          : ""
                      }`}
                    >
                      <Opt size={16} weight="regular" />
                    </button>
                  );
                })}
              </Box>
            )}
          </Box>
          <Box className="min-w-0 flex-1">
            {isEditing ? (
              <input
                ref={inputRef}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancel();
                  }
                }}
                className="-mx-2 block w-full rounded-(--radius-2) bg-(--gray-2) px-2 py-1 font-medium text-(--gray-12) text-[22px] outline-none ring-(--accent-7) ring-1 focus:ring-(--accent-8) focus:ring-2"
              />
            ) : (
              <Text
                as="div"
                weight="medium"
                className="truncate text-(--gray-12) text-[22px] leading-tight"
              >
                {tile.name}
              </Text>
            )}
            {isEditing ? (
              <input
                value={taglineDraft}
                onChange={(e) => setTaglineDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancel();
                  }
                }}
                className="-mx-2 mt-1 block w-full rounded-(--radius-2) bg-(--gray-2) px-2 py-0.5 text-(--gray-11) text-[12px] outline-none ring-(--accent-7) ring-1 focus:ring-(--accent-8) focus:ring-2"
                placeholder="Tagline"
              />
            ) : (
              <Text as="div" className="truncate text-(--gray-11) text-[12px]">
                {tile.tagline}
              </Text>
            )}
          </Box>
        </Flex>
        {onUpdate && (
          <button
            type="button"
            onClick={isEditing ? commit : startEditing}
            aria-label={isEditing ? "Done editing" : "Edit project"}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-(--radius-2) border transition-colors ${
              isEditing
                ? "border-(--accent-7) bg-(--accent-3) text-(--accent-11) hover:bg-(--accent-4)"
                : "border-(--gray-5) bg-(--gray-1) text-(--gray-11) hover:border-(--gray-7) hover:bg-(--gray-2) hover:text-(--gray-12)"
            }`}
          >
            {isEditing ? (
              <Check size={16} weight="bold" />
            ) : (
              <DotsThree size={16} weight="bold" />
            )}
          </button>
        )}
      </Flex>
      {members.length > 0 && (
        <Flex align="center" gap="3" className="mt-3" wrap="wrap">
          <Flex align="center" gap="-1">
            {members.map((m, i) => (
              <Box
                key={`${m.name}-${i}`}
                title={m.name}
                className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-(--gray-1) bg-(--gray-4) text-(--gray-12) text-[10px] first:ml-0"
                style={{ zIndex: members.length - i }}
              >
                {m.initials}
              </Box>
            ))}
          </Flex>
          <Text as="span" className="text-(--gray-10) text-[11px]">
            {members.length}{" "}
            {members.length === 1 ? "collaborator" : "collaborators"}
          </Text>
        </Flex>
      )}
    </TileFrame>
  );
}
