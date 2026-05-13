import {
  ArrowLeft,
  ArrowSquareOut,
  ChartLineUp,
  ChatCircleText,
  ClockClockwise,
  DotsThree,
  FileText,
  GaugeIcon,
  type IconProps,
  Lightbulb,
  Lightning,
  Megaphone,
  Microphone,
  Plus,
  Rocket,
} from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import { openUrlInBrowser } from "@utils/browser";
import { type ComponentType, type ReactNode, useMemo } from "react";
import {
  getProject,
  type Project,
  type ProjectActivityEntry,
} from "../data/projects";

const ICON_MAP: Record<Project["iconId"], ComponentType<IconProps>> = {
  rocket: Rocket,
  microphone: Microphone,
  megaphone: Megaphone,
};

function Sparkline({ values }: { values: number[] }) {
  const width = 220;
  const height = 36;
  const max = Math.max(...values, 1);
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((v, i) => `${i * stepX},${height - (v / max) * (height - 4) - 2}`)
    .join(" ");
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label="14-day sparkline"
    >
      <title>14-day sparkline</title>
      <polygon points={areaPoints} fill="var(--green-3)" />
      <polyline
        points={points}
        fill="none"
        stroke="var(--green-11)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SectionHeader({
  icon,
  title,
  count,
  action,
}: {
  icon: ReactNode;
  title: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <Flex align="center" justify="between" gap="2" className="mb-2">
      <Flex align="center" gap="2" className="text-(--gray-11)">
        {icon}
        <Text
          as="span"
          weight="medium"
          className="text-(--gray-12) text-[13px]"
        >
          {title}
        </Text>
        {count !== undefined && (
          <Text as="span" className="text-(--gray-10) text-[12px]">
            {count}
          </Text>
        )}
      </Flex>
      {action}
    </Flex>
  );
}

function DashboardsCard({ project }: { project: Project }) {
  if (!project.dashboards?.length) return null;
  return (
    <Box>
      <SectionHeader
        icon={<GaugeIcon size={14} weight="duotone" />}
        title="Dashboards"
        count={project.dashboards.length}
        action={
          <button
            type="button"
            className="flex items-center gap-1 text-(--gray-10) text-[11px] hover:text-(--gray-12)"
          >
            <Plus size={11} weight="bold" />
            Add
          </button>
        }
      />
      <Box className="overflow-hidden rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1)">
        {project.dashboards.map((d, i) => (
          <button
            type="button"
            key={d.id}
            onClick={() => openUrlInBrowser(d.url)}
            className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-(--gray-2) ${
              i > 0 ? "border-(--gray-4) border-t" : ""
            }`}
          >
            <Box className="mt-0.5 text-(--gray-10)">
              <ChartLineUp size={14} weight="regular" />
            </Box>
            <Box className="min-w-0 flex-1">
              <Flex align="center" gap="1.5">
                <Text
                  as="span"
                  weight="medium"
                  className="truncate text-(--gray-12) text-[13px]"
                >
                  {d.name}
                </Text>
                <ArrowSquareOut
                  size={10}
                  weight="bold"
                  className="shrink-0 text-(--gray-9)"
                />
              </Flex>
              <Text
                as="div"
                className="line-clamp-1 text-(--gray-11) text-[11px]"
              >
                {d.description}
              </Text>
            </Box>
            <Text as="span" className="shrink-0 text-(--gray-10) text-[11px]">
              {d.owner}
            </Text>
          </button>
        ))}
      </Box>
    </Box>
  );
}

function AutomationsCard({ project }: { project: Project }) {
  if (!project.automations?.length) return null;
  return (
    <Box>
      <SectionHeader
        icon={<Lightning size={14} weight="duotone" />}
        title="Automations"
        count={project.automations.length}
        action={
          <button
            type="button"
            className="flex items-center gap-1 text-(--gray-10) text-[11px] hover:text-(--gray-12)"
          >
            <Plus size={11} weight="bold" />
            New
          </button>
        }
      />
      <Box className="overflow-hidden rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1)">
        {project.automations.map((a, i) => (
          <Box
            key={a.id}
            className={`px-3 py-2.5 ${
              i > 0 ? "border-(--gray-4) border-t" : ""
            }`}
          >
            <Flex align="center" justify="between" gap="2">
              <Flex align="center" gap="2" className="min-w-0">
                <Box
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    a.enabled ? "bg-(--green-9)" : "bg-(--gray-7)"
                  }`}
                />
                <Text
                  as="span"
                  weight="medium"
                  className="truncate text-(--gray-12) text-[13px]"
                >
                  {a.title}
                </Text>
              </Flex>
              <Text as="span" className="shrink-0 text-(--gray-10) text-[11px]">
                {a.schedule}
              </Text>
            </Flex>
            <Text
              as="div"
              className="mt-0.5 line-clamp-1 text-(--gray-11) text-[11px]"
            >
              {a.description}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function FilesCard({ project }: { project: Project }) {
  if (!project.files?.length) return null;
  return (
    <Box>
      <SectionHeader
        icon={<FileText size={14} weight="duotone" />}
        title="Files"
        count={project.files.length}
        action={
          <button
            type="button"
            className="flex items-center gap-1 text-(--gray-10) text-[11px] hover:text-(--gray-12)"
          >
            <Plus size={11} weight="bold" />
            Add
          </button>
        }
      />
      <Box className="overflow-hidden rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1)">
        {project.files.map((f, i) => (
          <Flex
            key={f.id}
            align="center"
            justify="between"
            gap="2"
            className={`px-3 py-2 ${i > 0 ? "border-(--gray-4) border-t" : ""}`}
          >
            <Flex align="center" gap="2" className="min-w-0">
              <FileText
                size={13}
                weight="regular"
                className="shrink-0 text-(--gray-10)"
              />
              <Text
                as="span"
                className="truncate font-mono text-(--gray-12) text-[12px]"
              >
                {f.name}
              </Text>
            </Flex>
            <Text as="span" className="shrink-0 text-(--gray-10) text-[11px]">
              {f.updatedLabel}
            </Text>
          </Flex>
        ))}
      </Box>
    </Box>
  );
}

const ACTIVITY_ICON: Record<ProjectActivityEntry["kind"], ReactNode> = {
  automation: <Lightning size={13} weight="regular" />,
  dashboard: <ChartLineUp size={13} weight="regular" />,
  task: <ChatCircleText size={13} weight="regular" />,
  file: <FileText size={13} weight="regular" />,
};

function ActivityCard({ project }: { project: Project }) {
  if (!project.activity?.length) return null;
  return (
    <Box>
      <SectionHeader
        icon={<ClockClockwise size={14} weight="duotone" />}
        title="Recent activity"
      />
      <Box className="overflow-hidden rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1)">
        {project.activity.map((e, i) => (
          <Flex
            key={e.id}
            align="start"
            gap="2.5"
            className={`px-3 py-2.5 ${
              i > 0 ? "border-(--gray-4) border-t" : ""
            }`}
          >
            <Box className="mt-0.5 text-(--gray-10)">
              {ACTIVITY_ICON[e.kind]}
            </Box>
            <Box className="min-w-0 flex-1">
              <Text
                as="div"
                className="line-clamp-2 text-(--gray-12) text-[12px]"
              >
                {e.text}
              </Text>
            </Box>
            <Text as="span" className="shrink-0 text-(--gray-10) text-[11px]">
              {e.when}
            </Text>
          </Flex>
        ))}
      </Box>
    </Box>
  );
}

function PinnedSkillsCard({ project }: { project: Project }) {
  if (!project.pinnedSkills?.length) return null;
  return (
    <Box>
      <SectionHeader
        icon={<Lightbulb size={14} weight="duotone" />}
        title="Pinned skills"
        count={project.pinnedSkills.length}
      />
      <Flex direction="column" gap="1.5">
        {project.pinnedSkills.map((s) => (
          <Flex
            key={s}
            align="center"
            gap="2"
            className="rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-3 py-2"
          >
            <Lightbulb
              size={13}
              weight="regular"
              className="text-(--gray-10)"
            />
            <Text as="span" className="text-(--gray-12) text-[12px]">
              {s}
            </Text>
          </Flex>
        ))}
      </Flex>
    </Box>
  );
}

function ProjectChatInput({ projectName }: { projectName: string }) {
  return (
    <Box className="rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3">
      <Text as="div" className="mb-2 text-(--gray-10) text-[12px]">
        Ask anything about {projectName} — I have its dashboards, automations,
        and files in context.
      </Text>
      <Flex
        align="center"
        gap="2"
        className="rounded-(--radius-2) border border-(--gray-4) bg-(--gray-2) px-3 py-2.5"
      >
        <Plus size={14} weight="bold" className="text-(--gray-10)" />
        <Text as="span" className="flex-1 text-(--gray-10) text-[13px] italic">
          e.g. "summarize today's waitlist signups for the launch standup"
        </Text>
        <Microphone size={14} weight="regular" className="text-(--gray-10)" />
      </Flex>
    </Box>
  );
}

export function WorkProjectDetailView() {
  const projectId = useNavigationStore((s) => s.workSelectedProjectId);
  const navigateToWorkProjects = useNavigationStore(
    (s) => s.navigateToWorkProjects,
  );

  const project = useMemo(
    () => (projectId ? getProject(projectId) : undefined),
    [projectId],
  );

  if (!project) {
    return (
      <Box className="flex h-full w-full items-center justify-center">
        <Text as="div" className="text-(--gray-11) text-[13px]">
          Project not found.{" "}
          <button
            type="button"
            onClick={navigateToWorkProjects}
            className="text-(--gray-12) underline underline-offset-2"
          >
            Back to projects
          </button>
        </Text>
      </Box>
    );
  }

  const Icon = ICON_MAP[project.iconId];

  return (
    <Box className="scrollbar-overlay-y h-full w-full overflow-y-auto">
      <Flex
        direction="column"
        gap="5"
        className="mx-auto w-full max-w-[920px] px-6 pt-8 pb-12"
      >
        <Flex direction="column" gap="3">
          <button
            type="button"
            onClick={navigateToWorkProjects}
            className="-ml-1 flex w-fit items-center gap-1 text-(--gray-10) text-[12px] transition-colors hover:text-(--gray-12)"
          >
            <ArrowLeft size={12} weight="bold" />
            Projects
          </button>

          <Flex align="start" justify="between" gap="3">
            <Flex align="center" gap="3" className="min-w-0">
              <Flex
                align="center"
                justify="center"
                className="h-11 w-11 shrink-0 rounded-(--radius-2) bg-(--gray-3) text-(--gray-11)"
              >
                <Icon size={22} weight="regular" />
              </Flex>
              <Box className="min-w-0">
                <Text
                  as="div"
                  weight="medium"
                  className="truncate text-(--gray-12) text-[22px]"
                >
                  {project.name}
                </Text>
                <Text as="div" className="text-(--gray-11) text-[12px]">
                  {project.tagline}
                </Text>
              </Box>
            </Flex>
            <Flex align="center" gap="2">
              {project.headline?.posthogUrl && (
                <button
                  type="button"
                  onClick={() =>
                    project.headline &&
                    openUrlInBrowser(project.headline.posthogUrl)
                  }
                  className="flex h-8 items-center gap-1.5 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-3 text-(--gray-11) text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) hover:text-(--gray-12)"
                >
                  Open in PostHog
                  <ArrowSquareOut size={11} weight="bold" />
                </button>
              )}
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) text-(--gray-11) transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) hover:text-(--gray-12)"
              >
                <DotsThree size={16} weight="bold" />
              </button>
            </Flex>
          </Flex>

          <Text as="div" className="max-w-[640px] text-(--gray-11) text-[13px]">
            {project.description}
          </Text>

          <Flex align="center" gap="3" wrap="wrap">
            <Flex align="center" gap="-1">
              {project.members.map((m, i) => (
                <Box
                  key={m.name}
                  title={m.name}
                  className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-(--gray-1) bg-(--gray-4) text-(--gray-12) text-[10px] first:ml-0"
                  style={{ zIndex: project.members.length - i }}
                >
                  {m.initials}
                </Box>
              ))}
            </Flex>
            <Text as="span" className="text-(--gray-10) text-[11px]">
              {project.members.length} collaborators · {project.updatedLabel}
            </Text>
          </Flex>
        </Flex>

        {project.headline && (
          <Box className="rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-4">
            <Flex align="center" justify="between" gap="2">
              <Flex align="center" gap="2">
                <Box className="h-1.5 w-1.5 animate-pulse rounded-full bg-(--green-9)" />
                <Text
                  as="span"
                  className="text-(--gray-10) text-[11px] uppercase tracking-wide"
                >
                  Live · {project.headline.label}
                </Text>
              </Flex>
              <button
                type="button"
                onClick={() =>
                  project.headline &&
                  openUrlInBrowser(project.headline.posthogUrl)
                }
                className="flex items-center gap-1 text-(--gray-10) text-[11px] hover:text-(--gray-12)"
              >
                View dashboard
                <ArrowSquareOut size={10} weight="bold" />
              </button>
            </Flex>
            <Flex align="baseline" gap="3" className="mt-1">
              <Text
                as="span"
                weight="medium"
                className="text-(--gray-12) text-[32px] leading-tight"
              >
                {project.headline.value}
              </Text>
              <Text as="span" className="text-(--green-11) text-[12px]">
                {project.headline.delta}
              </Text>
            </Flex>
            <Box className="mt-2">
              <Sparkline values={project.headline.sparkline} />
            </Box>
          </Box>
        )}

        <ProjectChatInput projectName={project.name} />

        <Box className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DashboardsCard project={project} />
          <AutomationsCard project={project} />
          <FilesCard project={project} />
          <ActivityCard project={project} />
        </Box>

        <PinnedSkillsCard project={project} />
      </Flex>
    </Box>
  );
}
