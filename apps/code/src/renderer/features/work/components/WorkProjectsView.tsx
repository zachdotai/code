import {
  type IconProps,
  MagnifyingGlass,
  Megaphone,
  Microphone,
  Plus,
  Rocket,
  SortAscending,
} from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import type { ComponentType } from "react";
import { PROJECTS, type Project } from "../data/projects";

const ICON_MAP: Record<Project["iconId"], ComponentType<IconProps>> = {
  rocket: Rocket,
  microphone: Microphone,
  megaphone: Megaphone,
};

function ProjectCard({ project }: { project: Project }) {
  const navigateToWorkProjectDetail = useNavigationStore(
    (s) => s.navigateToWorkProjectDetail,
  );

  const Icon = ICON_MAP[project.iconId];
  const clickable = !project.isPlaceholder;
  const handleClick = clickable
    ? () => navigateToWorkProjectDetail(project.id)
    : undefined;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!clickable}
      className={`group flex h-full flex-col gap-3 rounded-(--radius-3) border border-(--gray-4) bg-(--gray-1) p-4 text-left transition-colors ${
        clickable
          ? "cursor-pointer hover:border-(--gray-6) hover:bg-(--gray-2)"
          : "cursor-default opacity-60"
      }`}
    >
      <Flex
        align="center"
        justify="center"
        className="h-9 w-9 shrink-0 rounded-(--radius-2) bg-(--gray-3) text-(--gray-11)"
      >
        <Icon size={18} weight="regular" />
      </Flex>

      <Box>
        <Text
          as="div"
          weight="medium"
          className="truncate text-(--gray-12) text-[14px]"
        >
          {project.name}
        </Text>
        <Text as="div" className="text-(--gray-10) text-[12px]">
          {project.tagline}
        </Text>
      </Box>

      <Text as="div" className="mt-auto text-(--gray-9) text-[11px]">
        {project.updatedLabel}
      </Text>
    </button>
  );
}

export function WorkProjectsView() {
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
              A home for related dashboards, automations, files, and skills.
            </Text>
          </Flex>

          <Flex align="center" gap="2">
            <button
              type="button"
              title="Sort"
              className="flex h-8 w-8 items-center justify-center rounded-(--radius-2) text-(--gray-10) transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
            >
              <SortAscending size={14} weight="regular" />
            </button>
            <button
              type="button"
              title="Search"
              className="flex h-8 w-8 items-center justify-center rounded-(--radius-2) text-(--gray-10) transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
            >
              <MagnifyingGlass size={14} weight="regular" />
            </button>
            <button
              type="button"
              className="flex h-8 items-center gap-1.5 rounded-(--radius-2) bg-(--gray-12) px-3 text-(--gray-1) text-[13px] transition-colors hover:bg-(--gray-11)"
            >
              <Plus size={13} weight="bold" />
              New project
            </button>
          </Flex>
        </Flex>

        <Box className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PROJECTS.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </Box>
      </Flex>
    </Box>
  );
}
