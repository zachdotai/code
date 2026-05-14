import { ArrowRight } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type { WorkProject } from "@shared/types/work-projects";
import { useNavigationStore } from "@stores/navigationStore";
import { useMemo } from "react";
import { PROJECT_ICON_MAP } from "../canvas/icons";
import { useWorkProjects } from "../canvas/useProjectCanvas";

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
  const Icon = PROJECT_ICON_MAP[project.iconId] ?? PROJECT_ICON_MAP.lightbulb;

  return (
    <button
      type="button"
      onClick={() => navigateToWorkProjectDetail(project.id)}
      className="group flex h-full min-w-0 flex-col gap-2 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2)"
    >
      <Flex
        align="center"
        justify="center"
        className="h-8 w-8 shrink-0 rounded-(--radius-2) bg-(--gray-3) text-(--gray-11) transition-colors group-hover:bg-(--gray-4)"
      >
        <Icon size={16} weight="regular" />
      </Flex>
      <Box className="min-w-0">
        <Text
          as="div"
          weight="medium"
          className="truncate text-(--gray-12) text-[13px]"
        >
          {project.name}
        </Text>
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
    </button>
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
