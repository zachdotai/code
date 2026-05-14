import {
  BookOpen,
  Brain,
  ClockClockwise,
  DotsThree,
  FolderSimple,
  type IconProps,
  Lock,
  LockOpen,
  Plugs,
} from "@phosphor-icons/react";
import { ScrollArea } from "@posthog/quill";
import { Box, Flex, Text } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { useNavigationStore, type WorkView } from "@stores/navigationStore";
import { type ComponentType, useState } from "react";
import { NewTaskItem } from "../../sidebar/components/items/HomeItem";
import { SidebarItem } from "../../sidebar/components/SidebarItem";
import { useWorkThreadTasks } from "../hooks/useWorkThreadTasks";
import { useWorkThreadParticipantsStore } from "../stores/workThreadParticipantsStore";

interface WorkSidebarItemSpec {
  icon: ComponentType<IconProps>;
  label: string;
  /** When set, the item navigates to that workView and lights up while active. */
  workView?: WorkView | "scheduled-section";
}

const STATIC_ITEMS: WorkSidebarItemSpec[] = [
  { icon: FolderSimple, label: "Projects" },
  {
    icon: ClockClockwise,
    label: "Scheduled",
    workView: "scheduled-section",
  },
  { icon: BookOpen, label: "Skills", workView: "library" },
  { icon: Plugs, label: "Data sources" },
  { icon: Brain, label: "Memory", workView: "memory" },
];

const THREADS_COLLAPSED_COUNT = 5;

function deriveThreadLabel(task: Task): string {
  const title = task.title?.trim();
  if (title) return title;
  const firstLine = task.description?.split(/\r?\n/)[0]?.trim();
  if (firstLine) return firstLine.slice(0, 80);
  return "Untitled task";
}

export function WorkSidebarMenu() {
  const workView = useNavigationStore((s) => s.workView);
  const activeTaskId = useNavigationStore((s) => s.workActiveTaskId);
  const navigateToWorkHome = useNavigationStore((s) => s.navigateToWorkHome);
  const navigateToWorkLibrary = useNavigationStore(
    (s) => s.navigateToWorkLibrary,
  );
  const navigateToWorkScheduledList = useNavigationStore(
    (s) => s.navigateToWorkScheduledList,
  );
  const navigateToWorkDataSources = useNavigationStore(
    (s) => s.navigateToWorkDataSources,
  );
  const navigateToWorkProjects = useNavigationStore(
    (s) => s.navigateToWorkProjects,
  );
  const navigateToWorkMemory = useNavigationStore(
    (s) => s.navigateToWorkMemory,
  );
  const navigateToWorkTask = useNavigationStore((s) => s.navigateToWorkTask);

  const { data: threadTasks } = useWorkThreadTasks();
  const participantsByTask = useWorkThreadParticipantsStore(
    (s) => s.participantsByTask,
  );
  const [threadsExpanded, setThreadsExpanded] = useState(false);

  const isHomeActive = workView === "home";
  const isLibraryActive = workView === "library";
  const isScheduledActive =
    workView === "scheduled-list" ||
    workView === "scheduled-create-prompt" ||
    workView === "scheduled-edit";
  const isDataSourcesActive = workView === "data-sources";
  const isProjectsActive = workView === "projects";
  const isMemoryActive = workView === "memory";

  const threadsWithTasks: { id: string; task: Task }[] = threadTasks.map(
    (task) => ({ id: task.id, task }),
  );

  const hasOverflow = threadsWithTasks.length > THREADS_COLLAPSED_COUNT;
  const visibleThreads =
    threadsExpanded || !hasOverflow
      ? threadsWithTasks
      : threadsWithTasks.slice(0, THREADS_COLLAPSED_COUNT);
  const hiddenCount = threadsWithTasks.length - visibleThreads.length;

  return (
    <Box height="100%" position="relative">
      <ScrollArea className="h-full overflow-y-auto overflow-x-hidden">
        <Flex direction="column" py="2" px="2" gap="1px">
          <Box mb="2">
            <NewTaskItem
              isActive={isHomeActive}
              onClick={navigateToWorkHome}
              variant="primary"
            />
          </Box>

          {STATIC_ITEMS.map((item) => {
            const Icon = item.icon;
            const isScheduled = item.workView === "scheduled-section";
            const isDataSources = item.label === "Data sources";
            const isProjects = item.label === "Projects";
            const isMemory = item.workView === "memory";
            const isSkills = item.workView === "library";
            const isActive =
              (isScheduled && isScheduledActive) ||
              (isDataSources && isDataSourcesActive) ||
              (isProjects && isProjectsActive) ||
              (isMemory && isMemoryActive) ||
              (isSkills && isLibraryActive);
            const onClick = isScheduled
              ? navigateToWorkScheduledList
              : isDataSources
                ? navigateToWorkDataSources
                : isProjects
                  ? navigateToWorkProjects
                  : isMemory
                    ? navigateToWorkMemory
                    : isSkills
                      ? navigateToWorkLibrary
                      : undefined;
            return (
              <Box key={item.label}>
                <SidebarItem
                  depth={0}
                  icon={
                    <Icon size={16} weight={isActive ? "fill" : "regular"} />
                  }
                  label={item.label}
                  isActive={isActive}
                  onClick={onClick}
                />
              </Box>
            );
          })}

          {threadsWithTasks.length > 0 && (
            <>
              <Box px="2" pt="3" pb="1">
                <Text
                  as="div"
                  className="font-medium text-(--gray-10) text-[11px] uppercase tracking-wide"
                >
                  Threads
                </Text>
              </Box>

              {visibleThreads.map(({ id, task }) => {
                const isActive =
                  workView === "task-detail" && activeTaskId === id;
                const serverCollaborators = (() => {
                  const config = task.repository_config as
                    | { collaborators?: unknown }
                    | null
                    | undefined;
                  return Array.isArray(config?.collaborators)
                    ? (config.collaborators as unknown[]).filter(
                        (v): v is string => typeof v === "string",
                      )
                    : [];
                })();
                const localCollaborators = participantsByTask[id] ?? [];
                const sharedCount = new Set([
                  ...serverCollaborators,
                  ...localCollaborators,
                ]).size;
                const isShared = sharedCount > 0;
                const LockIcon = isShared ? LockOpen : Lock;
                return (
                  <Box key={id}>
                    <SidebarItem
                      depth={0}
                      icon={
                        <LockIcon
                          size={16}
                          weight={isActive ? "fill" : "regular"}
                        />
                      }
                      label={deriveThreadLabel(task)}
                      isActive={isActive}
                      onClick={() => navigateToWorkTask(id)}
                      endContent={
                        isShared ? (
                          <span className="shrink-0 rounded-full bg-(--gray-a4) px-1.5 py-px text-(--gray-11) text-[11px] leading-tight">
                            +{sharedCount}
                          </span>
                        ) : undefined
                      }
                    />
                  </Box>
                );
              })}

              {hasOverflow && (
                <Box>
                  <SidebarItem
                    depth={0}
                    icon={<DotsThree size={16} weight="bold" />}
                    label={
                      threadsExpanded
                        ? "Show less"
                        : `Show more (${hiddenCount})`
                    }
                    isActive={false}
                    onClick={() => setThreadsExpanded((v) => !v)}
                  />
                </Box>
              )}
            </>
          )}
        </Flex>
      </ScrollArea>
    </Box>
  );
}
