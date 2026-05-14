import {
  ArrowRight,
  PushPin,
  PushPinSlash,
  TrashSimple,
} from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type { WorkProject } from "@shared/types/work-projects";
import { useNavigationStore } from "@stores/navigationStore";
import { useMemo } from "react";
import { PROJECT_ICON_MAP } from "../canvas/icons";
import { useWorkProjects } from "../canvas/useProjectCanvas";
import { useDeleteProjectWithUndo } from "../hooks/useDeleteProjectWithUndo";
import { usePinProject } from "../hooks/usePinProject";

const RAIL_LIMIT = 3;

function formatUpdated(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function RecentCard({ project }: { project: WorkProject }) {
  const navigateToWorkProjectDetail = useNavigationStore(
    (s) => s.navigateToWorkProjectDetail,
  );
  const pinProject = usePinProject();
  const deleteWithUndo = useDeleteProjectWithUndo();
  const Icon = PROJECT_ICON_MAP[project.iconId] ?? PROJECT_ICON_MAP.lightbulb;
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
      className="group relative flex h-full min-w-0 cursor-pointer flex-col gap-2 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) focus:outline-none focus-visible:border-(--gray-8) focus-visible:ring-(--gray-7) focus-visible:ring-2"
    >
      <Flex
        align="center"
        justify="center"
        className="h-8 w-8 shrink-0 rounded-(--radius-2) bg-(--gray-3) text-(--gray-11) transition-colors group-hover:bg-(--gray-4)"
      >
        <Icon size={16} weight="regular" />
      </Flex>
      <Box className="min-w-0">
        <Flex align="center" gap="1.5">
          {isPinned && (
            <PushPin
              size={10}
              weight="fill"
              className="shrink-0 text-(--gray-10)"
            />
          )}
          <Text
            as="div"
            weight="medium"
            className="truncate text-(--gray-12) text-[13px]"
          >
            {project.name}
          </Text>
        </Flex>
        <Text
          as="div"
          className="line-clamp-1 text-(--gray-11) text-[12px] leading-snug"
        >
          {project.tagline}
        </Text>
      </Box>
      <Text as="div" className="mt-auto text-(--gray-10) text-[11px]">
        Updated {formatUpdated(project.updatedAt)}
      </Text>

      <Flex
        align="center"
        gap="1"
        className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <button
          type="button"
          onClick={handleTogglePin}
          aria-label={isPinned ? "Unpin project" : "Pin project"}
          title={isPinned ? "Unpin from sidebar" : "Pin to sidebar"}
          className="flex h-5 w-5 items-center justify-center rounded-(--radius-2) bg-(--gray-1) text-(--gray-11) shadow-sm transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
        >
          {isPinned ? (
            <PushPinSlash size={11} weight="bold" />
          ) : (
            <PushPin size={11} weight="bold" />
          )}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          aria-label="Delete project"
          title="Delete project"
          className="flex h-5 w-5 items-center justify-center rounded-(--radius-2) bg-(--gray-1) text-(--gray-11) shadow-sm transition-colors hover:bg-(--red-3) hover:text-(--red-11)"
        >
          <TrashSimple size={11} weight="bold" />
        </button>
      </Flex>
    </div>
  );
}

export function WorkPinnedProjects() {
  const { data: projects } = useWorkProjects();

  const pinned = useMemo(() => {
    const all = projects ?? [];
    return all
      .filter((p) => p.pinnedAt)
      .sort(
        (a, b) =>
          new Date(b.pinnedAt ?? 0).getTime() -
          new Date(a.pinnedAt ?? 0).getTime(),
      )
      .slice(0, RAIL_LIMIT);
  }, [projects]);

  if (pinned.length === 0) return null;

  return (
    <Box className="w-full">
      <Text
        as="div"
        weight="medium"
        className="mb-2 text-(--gray-12) text-[13px]"
      >
        Pinned
      </Text>
      <Box className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {pinned.map((p) => (
          <RecentCard key={p.id} project={p} />
        ))}
      </Box>
    </Box>
  );
}

export function WorkRecentProjects() {
  const { data: projects } = useWorkProjects();
  const navigateToWorkProjects = useNavigationStore(
    (s) => s.navigateToWorkProjects,
  );

  const recent = useMemo(() => {
    const all = projects ?? [];
    // Exclude pinned — they're shown separately in WorkPinnedProjects.
    return all
      .filter((p) => !p.pinnedAt)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .slice(0, RAIL_LIMIT);
  }, [projects]);

  if (recent.length === 0) return null;

  return (
    <Box className="w-full">
      <Flex align="center" justify="between" className="mb-2">
        <Text as="div" weight="medium" className="text-(--gray-12) text-[13px]">
          Recent projects
        </Text>
        <button
          type="button"
          onClick={navigateToWorkProjects}
          className="flex items-center gap-1 text-(--gray-11) text-[12px] transition-colors hover:text-(--gray-12)"
        >
          See all
          <ArrowRight size={11} weight="bold" />
        </button>
      </Flex>
      <Box className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {recent.map((p) => (
          <RecentCard key={p.id} project={p} />
        ))}
      </Box>
    </Box>
  );
}
