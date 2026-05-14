import { useFolders } from "@features/folders/hooks/useFolders";
import {
  CalendarCheck,
  ChartLineUp,
  CurrencyDollar,
  type IconProps,
  Megaphone,
} from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import type {
  TaskCreationInput,
  TaskService,
} from "@renderer/features/task-detail/service/service";
import { trpcClient } from "@renderer/trpc/client";
import { toast } from "@renderer/utils/toast";
import { useNavigationStore } from "@stores/navigationStore";
import { logger } from "@utils/logger";
import { type ComponentType, useState } from "react";
import { useWorkThreadsStore } from "../stores/workThreadsStore";

const log = logger.scope("work-sample-projects");

interface SampleProject {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
  prompt: string;
}

const PROJECTS: SampleProject[] = [
  {
    icon: CalendarCheck,
    title: "Weekly status",
    description: "What you shipped, what's next, what's stuck",
    prompt:
      "Draft my weekly status update — what I shipped, what's next, what I'm stuck on.",
  },
  {
    icon: Megaphone,
    title: "Campaign performance",
    description: "Which channels are converting this week",
    prompt:
      "Summarize this week's marketing campaign performance and what's actually converting.",
  },
  {
    icon: ChartLineUp,
    title: "Feature adoption",
    description: "Which new features are sticking",
    prompt:
      "Which recently shipped features are users actually adopting, and which are flat?",
  },
  {
    icon: CurrencyDollar,
    title: "Pipeline brief",
    description: "Top deals, risk, and momentum",
    prompt:
      "Pull together this week's pipeline brief — top deals, risk signals, and where momentum is shifting.",
  },
];

async function resolveRepoPath(folders: string[]): Promise<string> {
  if (folders.length > 0) return folders[0];
  return trpcClient.os.getHomeDir.query();
}

function SampleCard({
  project,
  onCreate,
  disabled,
}: {
  project: SampleProject;
  onCreate: (prompt: string) => void;
  disabled: boolean;
}) {
  const Icon = project.icon;
  return (
    <button
      type="button"
      onClick={() => onCreate(project.prompt)}
      disabled={disabled}
      className="flex flex-1 flex-col items-start gap-1 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Box className="text-(--gray-11)">
        <Icon size={20} weight="duotone" />
      </Box>
      <Text as="div" weight="medium" className="text-(--gray-12) text-[13px]">
        {project.title}
      </Text>
      <Text as="div" className="text-(--gray-11) text-[12px]">
        {project.description}
      </Text>
    </button>
  );
}

export function WorkSampleProjects() {
  const navigateToWorkTask = useNavigationStore((s) => s.navigateToWorkTask);
  const addThread = useWorkThreadsStore((s) => s.addThread);
  const { folders, isLoaded: foldersLoaded } = useFolders();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async (prompt: string) => {
    if (isSubmitting || !foldersLoaded) return;

    setIsSubmitting(true);
    try {
      const folderPaths = folders.map((f) => f.path);
      const repoPath = await resolveRepoPath(folderPaths);

      const input: TaskCreationInput = {
        content: prompt,
        repoPath,
        workspaceMode: "local",
      };

      const taskService = get<TaskService>(RENDERER_TOKENS.TaskService);
      const result = await taskService.createTask(input, (output) => {
        addThread(output.task.id);
        navigateToWorkTask(output.task.id);
      });

      if (!result.success) {
        toast.error("Failed to start task", { description: result.error });
        log.error("Sample project task creation failed", {
          failedStep: result.failedStep,
          error: result.error,
        });
      }
    } catch (error) {
      const description =
        error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to start task", { description });
      log.error("Unexpected error during sample project creation", { error });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Flex gap="2" className="w-full">
      {PROJECTS.map((p) => (
        <SampleCard
          key={p.title}
          project={p}
          onCreate={handleCreate}
          disabled={isSubmitting}
        />
      ))}
    </Flex>
  );
}
