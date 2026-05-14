import {
  Archive,
  ArrowCounterClockwise,
  CaretDown,
  CaretRight,
  Check,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  PushPin,
  PushPinSlash,
  SortAscending,
  TrashSimple,
  X,
} from "@phosphor-icons/react";
import { AlertDialog, Box, Button, Flex, Text } from "@radix-ui/themes";
import type {
  ProjectIconId,
  ProjectMember,
  WorkProject,
} from "@shared/types/work-projects";
import { useNavigationStore } from "@stores/navigationStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PROJECT_ICON_MAP, PROJECT_ICON_OPTIONS } from "../canvas/icons";
import { useWorkProjects } from "../canvas/useProjectCanvas";
import { useArchivedProjects } from "../hooks/useArchivedProjects";
import { useArchiveProject } from "../hooks/useArchiveProject";
import { usePinProject } from "../hooks/usePinProject";
import { useUpdateProjectTitle } from "../hooks/useUpdateProjectTitle";
import { TemplateGallery } from "../templates/TemplateGallery";

type SortKey = "recent" | "name" | "tiles";

const SORT_LABEL: Record<SortKey, string> = {
  recent: "Recently updated",
  name: "Name",
  tiles: "Most tiles",
};

const SORT_ORDER: SortKey[] = ["recent", "name", "tiles"];

function formatUpdated(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Updated recently";
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "Just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function countContentTiles(project: WorkProject): number {
  return project.tiles.filter((t) => t.type !== "title").length;
}

function MemberAvatars({ members }: { members: ProjectMember[] }) {
  if (members.length === 0) return null;
  const shown = members.slice(0, 3);
  const rest = members.length - shown.length;
  return (
    <Flex align="center" className="shrink-0">
      {shown.map((m, i) => (
        <Box
          key={`${m.name}-${i}`}
          title={m.name}
          style={{ zIndex: members.length - i }}
          className="-ml-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-(--gray-1) bg-(--gray-4) text-(--gray-12) text-[9px] first:ml-0"
        >
          {m.initials}
        </Box>
      ))}
      {rest > 0 && (
        <Box className="-ml-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-(--gray-1) bg-(--gray-3) text-(--gray-11) text-[9px]">
          +{rest}
        </Box>
      )}
    </Flex>
  );
}

function ProjectCard({ project }: { project: WorkProject }) {
  const navigateToWorkProjectDetail = useNavigationStore(
    (s) => s.navigateToWorkProjectDetail,
  );
  const pinProject = usePinProject();
  const { archive } = useArchiveProject();
  const updateTitle = useUpdateProjectTitle();
  const Icon = PROJECT_ICON_MAP[project.iconId] ?? PROJECT_ICON_MAP.lightbulb;
  const tileCount = countContentTiles(project);
  const isPinned = !!project.pinnedAt;

  const [isEditing, setIsEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isEditing) setNameDraft(project.name);
  }, [project.name, isEditing]);

  useEffect(() => {
    if (isEditing) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditing]);

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

  const handleTogglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    void pinProject(project.id, !isPinned);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmOpen(true);
  };

  const handleConfirmArchive = () => {
    setConfirmOpen(false);
    void archive(project);
  };

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNameDraft(project.name);
    setIsEditing(true);
  };

  const commitName = useCallback(() => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== project.name) {
      void updateTitle(project.id, { name: trimmed });
    } else {
      setNameDraft(project.name);
    }
    setIsEditing(false);
  }, [nameDraft, project.id, project.name, updateTitle]);

  const cancelEdit = useCallback(() => {
    setNameDraft(project.name);
    setIsEditing(false);
    setIconPickerOpen(false);
  }, [project.name]);

  const handlePickIcon = (id: ProjectIconId) => {
    if (id !== project.iconId) void updateTitle(project.id, { iconId: id });
    setIconPickerOpen(false);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: need nested action buttons; <button>-in-<button> is invalid HTML.
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (isEditing) return;
        navigateToWorkProjectDetail(project.id);
      }}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigateToWorkProjectDetail(project.id);
        }
      }}
      className={`group relative flex h-full flex-col gap-3 rounded-(--radius-3) border bg-(--gray-1) p-4 text-left transition-colors focus:outline-none focus-visible:border-(--gray-8) focus-visible:ring-(--gray-7) focus-visible:ring-2 ${
        isEditing
          ? "cursor-default border-(--accent-7) ring-(--accent-6) ring-1"
          : "cursor-pointer border-(--gray-5) hover:border-(--gray-7) hover:bg-(--gray-2)"
      }`}
    >
      <Box ref={iconRef} className="relative">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIconPickerOpen((v) => !v);
          }}
          aria-label="Change icon"
          title="Change icon"
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-(--radius-2) bg-(--gray-3) text-(--gray-11) transition-colors hover:bg-(--gray-4) hover:text-(--gray-12)"
        >
          <Icon size={18} weight="regular" />
        </button>
        {iconPickerOpen && (
          <Box
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute top-11 left-0 z-20 grid grid-cols-5 gap-1.5 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) p-2 shadow-lg"
          >
            {PROJECT_ICON_OPTIONS.map((id) => {
              const Opt = PROJECT_ICON_MAP[id];
              return (
                <button
                  type="button"
                  key={id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePickIcon(id);
                  }}
                  aria-label={`Use ${id} icon`}
                  className={`flex h-8 w-8 items-center justify-center rounded-(--radius-2) text-(--gray-11) transition-colors hover:bg-(--gray-3) hover:text-(--gray-12) ${
                    id === project.iconId
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

      <Box className="min-h-0 flex-1">
        <Flex align="center" gap="1.5">
          {isPinned && !isEditing && (
            <PushPin
              size={11}
              weight="fill"
              className="shrink-0 text-(--gray-10)"
            />
          )}
          {isEditing ? (
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onBlur={commitName}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitName();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              className="-mx-1 block w-full min-w-0 rounded-(--radius-2) bg-(--gray-2) px-1 py-0.5 font-medium text-(--gray-12) text-[14px] outline-none ring-(--accent-7) ring-1 focus:ring-(--accent-8) focus:ring-2"
            />
          ) : (
            <Text
              as="div"
              weight="medium"
              className="truncate text-(--gray-12) text-[14px]"
            >
              {project.name}
            </Text>
          )}
        </Flex>
        <Text
          as="div"
          className="line-clamp-2 text-(--gray-11) text-[12px] leading-snug"
        >
          {project.tagline}
        </Text>
      </Box>

      <Flex align="center" justify="between" gap="2" className="mt-auto">
        <Flex align="center" gap="2" className="min-w-0">
          <Text as="span" className="text-(--gray-10) text-[11px]">
            {tileCount} {tileCount === 1 ? "tile" : "tiles"}
          </Text>
          <Text as="span" className="text-(--gray-10) text-[11px]">
            ·
          </Text>
          <Text as="span" className="truncate text-(--gray-10) text-[11px]">
            {formatUpdated(project.updatedAt)}
          </Text>
        </Flex>
        <MemberAvatars members={project.members} />
      </Flex>

      {/* Hover-visible action buttons. Pinned tiles stay pinnable. */}
      <Flex
        align="center"
        gap="1"
        className={`absolute top-3 right-3 transition-opacity ${
          isEditing
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        }`}
      >
        {isEditing ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              commitName();
            }}
            aria-label="Done editing"
            title="Done"
            className="flex h-6 w-6 items-center justify-center rounded-(--radius-2) border border-(--accent-7) bg-(--accent-3) text-(--accent-11) shadow-sm transition-colors hover:bg-(--accent-4)"
          >
            <Check size={12} weight="bold" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStartEdit}
            aria-label="Edit project"
            title="Rename / change icon"
            className="flex h-6 w-6 items-center justify-center rounded-(--radius-2) bg-(--gray-1) text-(--gray-11) shadow-sm transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
          >
            <PencilSimple size={12} weight="bold" />
          </button>
        )}
        <button
          type="button"
          onClick={handleTogglePin}
          aria-label={isPinned ? "Unpin project" : "Pin project"}
          title={isPinned ? "Unpin from sidebar" : "Pin to sidebar"}
          className="flex h-6 w-6 items-center justify-center rounded-(--radius-2) bg-(--gray-1) text-(--gray-11) shadow-sm transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
        >
          {isPinned ? (
            <PushPinSlash size={12} weight="bold" />
          ) : (
            <PushPin size={12} weight="bold" />
          )}
        </button>
        <button
          type="button"
          onClick={handleDeleteClick}
          aria-label="Delete project"
          title="Delete project"
          className="flex h-6 w-6 items-center justify-center rounded-(--radius-2) bg-(--gray-1) text-(--gray-11) shadow-sm transition-colors hover:bg-(--red-3) hover:text-(--red-11)"
        >
          <TrashSimple size={12} weight="bold" />
        </button>
      </Flex>

      <ArchiveConfirmDialog
        open={confirmOpen}
        projectName={project.name}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmArchive}
      />
    </div>
  );
}

function ArchiveConfirmDialog({
  open,
  projectName,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  projectName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialog.Content maxWidth="440px">
        <AlertDialog.Title>Delete project?</AlertDialog.Title>
        <AlertDialog.Description size="2">
          <Text>
            <Text weight="medium" className="text-(--gray-12)">
              {projectName}
            </Text>{" "}
            will be moved to{" "}
            <Text weight="medium" className="text-(--gray-12)">
              Archived projects
            </Text>{" "}
            at the bottom of this page. You can restore it any time.
          </Text>
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button variant="solid" color="red" onClick={onConfirm}>
              <Archive size={14} weight="bold" />
              Move to Archived
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

function SortMenu({
  sortKey,
  onChange,
}: {
  sortKey: SortKey;
  onChange: (key: SortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <Box className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Sort projects"
        className="flex h-8 items-center gap-1.5 rounded-(--radius-2) px-2 text-(--gray-11) text-[12px] transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
      >
        <SortAscending size={14} weight="regular" />
        <Text as="span">{SORT_LABEL[sortKey]}</Text>
        <CaretDown size={10} weight="bold" />
      </button>
      {open && (
        <Box className="absolute top-9 right-0 z-20 w-48 overflow-hidden rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) shadow-lg">
          {SORT_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                onChange(k);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] hover:bg-(--gray-3) ${
                sortKey === k ? "text-(--gray-12)" : "text-(--gray-11)"
              }`}
            >
              {SORT_LABEL[k]}
              {sortKey === k && <Check size={12} weight="bold" />}
            </button>
          ))}
        </Box>
      )}
    </Box>
  );
}

function SearchField({
  value,
  onChange,
  expanded,
  onToggle,
}: {
  value: string;
  onChange: (v: string) => void;
  expanded: boolean;
  onToggle: (next: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  if (!expanded && value.length === 0) {
    return (
      <button
        type="button"
        onClick={() => onToggle(true)}
        title="Search projects"
        aria-label="Search projects"
        className="flex h-8 w-8 items-center justify-center rounded-(--radius-2) text-(--gray-10) transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
      >
        <MagnifyingGlass size={14} weight="regular" />
      </button>
    );
  }

  return (
    <Flex
      align="center"
      gap="1"
      className="h-8 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2 transition-colors focus-within:border-(--gray-7)"
    >
      <MagnifyingGlass
        size={13}
        weight="regular"
        className="text-(--gray-10)"
      />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            onToggle(false);
          }
        }}
        placeholder="Search projects"
        className="w-[160px] bg-transparent text-(--gray-12) text-[12px] outline-none placeholder:text-(--gray-9)"
      />
      <button
        type="button"
        onClick={() => {
          onChange("");
          onToggle(false);
        }}
        aria-label="Clear search"
        className="flex h-5 w-5 items-center justify-center rounded-(--radius-2) text-(--gray-10) hover:bg-(--gray-3) hover:text-(--gray-12)"
      >
        <X size={11} weight="bold" />
      </button>
    </Flex>
  );
}

export function WorkProjectsView() {
  const { data: projects, isLoading } = useWorkProjects();

  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [search, setSearch] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);

  const handleNewProject = useCallback(() => {
    setGalleryOpen(true);
  }, []);

  const filteredSorted = useMemo(() => {
    const all = projects ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? all.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.tagline.toLowerCase().includes(q),
        )
      : all;
    const sorted = filtered.slice();
    if (sortKey === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortKey === "tiles") {
      sorted.sort((a, b) => countContentTiles(b) - countContentTiles(a));
    } else {
      sorted.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    }
    return sorted;
  }, [projects, search, sortKey]);

  return (
    <Box className="scrollbar-overlay-y h-full w-full overflow-y-auto">
      <Flex
        direction="column"
        gap="6"
        className="mx-auto w-full max-w-[960px] px-8 pt-12 pb-12"
      >
        <Flex direction="column" gap="3">
          <Flex align="start" justify="between" gap="3" wrap="wrap">
            <Flex direction="column" gap="1">
              <Text
                as="div"
                weight="medium"
                className="text-(--gray-12) text-[22px]"
              >
                Projects
              </Text>
              <Text as="div" className="text-(--gray-11) text-[13px]">
                Sticky notes, charts, half-baked ideas – drag them in, yell at
                the chat, call it strategy.
              </Text>
            </Flex>

            <button
              type="button"
              onClick={handleNewProject}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-(--radius-2) bg-(--gray-12) px-3 text-(--gray-1) text-[13px] transition-colors hover:bg-(--gray-11)"
            >
              <Plus size={13} weight="bold" />
              New project
            </button>
          </Flex>

          <Flex align="center" gap="2">
            <SortMenu sortKey={sortKey} onChange={setSortKey} />
            <SearchField
              value={search}
              onChange={setSearch}
              expanded={searchExpanded}
              onToggle={setSearchExpanded}
            />
          </Flex>
        </Flex>

        {isLoading && !projects ? (
          <Text as="div" className="text-(--gray-11) text-[13px]">
            Loading projects…
          </Text>
        ) : filteredSorted.length === 0 ? (
          <EmptyState hasSearch={search.length > 0} onNew={handleNewProject} />
        ) : (
          <Box className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredSorted.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </Box>
        )}

        <ArchivedProjectsSection />
      </Flex>
      <TemplateGallery open={galleryOpen} onOpenChange={setGalleryOpen} />
    </Box>
  );
}

function ArchivedProjectsSection() {
  const { data: archived } = useArchivedProjects();
  const [open, setOpen] = useState(false);
  const { unarchive } = useArchiveProject();
  const count = archived?.length ?? 0;

  if (count === 0) return null;

  return (
    <Box className="mt-2 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1)">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-(--radius-3) px-4 py-3 text-left transition-colors hover:bg-(--gray-2)"
      >
        <Flex align="center" gap="2" className="min-w-0">
          {open ? (
            <CaretDown
              size={12}
              weight="bold"
              className="shrink-0 text-(--gray-11)"
            />
          ) : (
            <CaretRight
              size={12}
              weight="bold"
              className="shrink-0 text-(--gray-11)"
            />
          )}
          <Archive size={14} weight="regular" className="text-(--gray-11)" />
          <Text
            as="span"
            weight="medium"
            className="text-(--gray-12) text-[13px]"
          >
            Archived projects
          </Text>
          <Text as="span" className="text-(--gray-10) text-[12px]">
            {count}
          </Text>
        </Flex>
      </button>
      {open && (
        <Box className="border-(--gray-4) border-t">
          <Flex direction="column">
            {(archived ?? []).map((p, i) => (
              <ArchivedRow
                key={p.id}
                project={p}
                isLast={i === count - 1}
                onRestore={() => void unarchive(p)}
              />
            ))}
          </Flex>
        </Box>
      )}
    </Box>
  );
}

function ArchivedRow({
  project,
  isLast,
  onRestore,
}: {
  project: WorkProject;
  isLast: boolean;
  onRestore: () => void;
}) {
  const Icon = PROJECT_ICON_MAP[project.iconId] ?? PROJECT_ICON_MAP.lightbulb;
  const archivedLabel = project.archivedAt
    ? `Archived ${formatUpdated(project.archivedAt)}`
    : "Archived";

  return (
    <Flex
      align="center"
      gap="3"
      className={`px-4 py-2.5 ${isLast ? "" : "border-(--gray-4) border-b"}`}
    >
      <Flex
        align="center"
        justify="center"
        className="h-8 w-8 shrink-0 rounded-(--radius-2) bg-(--gray-3) text-(--gray-11)"
      >
        <Icon size={15} weight="regular" />
      </Flex>
      <Box className="min-w-0 flex-1">
        <Text
          as="div"
          weight="medium"
          className="truncate text-(--gray-12) text-[13px]"
        >
          {project.name}
        </Text>
        <Text as="div" className="truncate text-(--gray-10) text-[11px]">
          {archivedLabel}
        </Text>
      </Box>
      <button
        type="button"
        onClick={onRestore}
        title="Restore project"
        aria-label={`Restore ${project.name}`}
        className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2.5 text-(--gray-11) text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) hover:text-(--gray-12)"
      >
        <ArrowCounterClockwise size={12} weight="bold" />
        Restore
      </button>
    </Flex>
  );
}

function EmptyState({
  hasSearch,
  onNew,
}: {
  hasSearch: boolean;
  onNew: () => void;
}) {
  return (
    <Flex
      direction="column"
      align="center"
      gap="2"
      className="rounded-(--radius-3) border border-(--gray-5) border-dashed bg-(--gray-1) px-6 py-12"
    >
      <Text as="div" weight="medium" className="text-(--gray-12) text-[14px]">
        {hasSearch ? "No projects match" : "No projects yet"}
      </Text>
      <Text
        as="div"
        className="max-w-[420px] text-center text-(--gray-11) text-[12px]"
      >
        {hasSearch
          ? "Try a different word, or clear the search to see all projects."
          : "Spin one up to start collecting tiles, notes, and metrics in one place."}
      </Text>
      {!hasSearch && (
        <button
          type="button"
          onClick={onNew}
          className="mt-2 flex h-8 items-center gap-1.5 rounded-(--radius-2) bg-(--gray-12) px-3 text-(--gray-1) text-[13px] transition-colors hover:bg-(--gray-11)"
        >
          <Plus size={13} weight="bold" />
          New project
        </button>
      )}
    </Flex>
  );
}
