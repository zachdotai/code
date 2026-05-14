import {
  CaretDown,
  Check,
  MagnifyingGlass,
  Plus,
  PushPin,
  PushPinSlash,
  SortAscending,
  TrashSimple,
  X,
} from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type { ProjectMember, WorkProject } from "@shared/types/work-projects";
import { useNavigationStore } from "@stores/navigationStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PROJECT_ICON_MAP } from "../canvas/icons";
import { useWorkProjects } from "../canvas/useProjectCanvas";
import { useDeleteProjectWithUndo } from "../hooks/useDeleteProjectWithUndo";
import { usePinProject } from "../hooks/usePinProject";
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
  const deleteWithUndo = useDeleteProjectWithUndo();
  const Icon = PROJECT_ICON_MAP[project.iconId] ?? PROJECT_ICON_MAP.lightbulb;
  const tileCount = countContentTiles(project);
  const isPinned = !!project.pinnedAt;

  const handleTogglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    void pinProject(project.id, !isPinned);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    void deleteWithUndo(project);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: need nested action buttons; <button>-in-<button> is invalid HTML.
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigateToWorkProjectDetail(project.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigateToWorkProjectDetail(project.id);
        }
      }}
      className="group relative flex h-full cursor-pointer flex-col gap-3 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-4 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) focus:outline-none focus-visible:border-(--gray-8) focus-visible:ring-(--gray-7) focus-visible:ring-2"
    >
      <Flex align="center" justify="between" gap="2">
        <Flex
          align="center"
          justify="center"
          className="h-9 w-9 shrink-0 rounded-(--radius-2) bg-(--gray-3) text-(--gray-11) transition-colors group-hover:bg-(--gray-4)"
        >
          <Icon size={18} weight="regular" />
        </Flex>
        <MemberAvatars members={project.members} />
      </Flex>

      <Box className="min-h-0 flex-1">
        <Flex align="center" gap="1.5">
          {isPinned && (
            <PushPin
              size={11}
              weight="fill"
              className="shrink-0 text-(--gray-10)"
            />
          )}
          <Text
            as="div"
            weight="medium"
            className="truncate text-(--gray-12) text-[14px]"
          >
            {project.name}
          </Text>
        </Flex>
        <Text
          as="div"
          className="line-clamp-2 text-(--gray-11) text-[12px] leading-snug"
        >
          {project.tagline}
        </Text>
      </Box>

      <Flex align="center" justify="between" gap="2" className="mt-auto">
        <Text as="div" className="text-(--gray-10) text-[11px]">
          {tileCount} {tileCount === 1 ? "tile" : "tiles"}
        </Text>
        <Text as="div" className="text-(--gray-10) text-[11px]">
          {formatUpdated(project.updatedAt)}
        </Text>
      </Flex>

      {/* Hover-visible action buttons. Pinned tiles stay pinnable. */}
      <Flex
        align="center"
        gap="1"
        className="absolute top-3 right-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
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
          onClick={handleDelete}
          aria-label="Delete project"
          title="Delete project"
          className="flex h-6 w-6 items-center justify-center rounded-(--radius-2) bg-(--gray-1) text-(--gray-11) shadow-sm transition-colors hover:bg-(--red-3) hover:text-(--red-11)"
        >
          <TrashSimple size={12} weight="bold" />
        </button>
      </Flex>
    </div>
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
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Flex direction="column" gap="1">
            <Text
              as="div"
              weight="medium"
              className="text-(--gray-12) text-[22px]"
            >
              Projects
            </Text>
            <Text as="div" className="text-(--gray-11) text-[13px]">
              A canvas of tiles — dashboards, files, notes, and skill outputs —
              with a chat that can shape it.
            </Text>
          </Flex>

          <Flex align="center" gap="2">
            <SortMenu sortKey={sortKey} onChange={setSortKey} />
            <SearchField
              value={search}
              onChange={setSearch}
              expanded={searchExpanded}
              onToggle={setSearchExpanded}
            />
            <button
              type="button"
              onClick={handleNewProject}
              className="flex h-8 items-center gap-1.5 rounded-(--radius-2) bg-(--gray-12) px-3 text-(--gray-1) text-[13px] transition-colors hover:bg-(--gray-11)"
            >
              <Plus size={13} weight="bold" />
              New project
            </button>
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
      </Flex>
      <TemplateGallery open={galleryOpen} onOpenChange={setGalleryOpen} />
    </Box>
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
