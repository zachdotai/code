import {
  ChartLineUp,
  ChatsTeardrop,
  Compass,
  Flask,
  type IconProps,
} from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import type { ComponentType } from "react";

interface SampleProject {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
  prompt: string;
}

const PROJECTS: SampleProject[] = [
  {
    icon: ChartLineUp,
    title: "Weekly product update",
    description: "Narrate metrics for your team every Monday",
    prompt: "Draft this Monday's product update for my team.",
  },
  {
    icon: Flask,
    title: "Experiment readouts",
    description: "Draft a writeup once results reach stat-sig",
    prompt: "Pick a stat-sig experiment and draft a readout.",
  },
  {
    icon: ChatsTeardrop,
    title: "Customer feedback themes",
    description: "Cluster interviews and support into trends",
    prompt:
      "Cluster recent support and interview notes into the top themes worth acting on.",
  },
  {
    icon: Compass,
    title: "Roadmap brief",
    description: "Spot signals and propose what to ship next",
    prompt:
      "Look at signals from the last month and propose what to ship next.",
  },
];

function SampleCard({ project }: { project: SampleProject }) {
  const setMode = useNavigationStore((s) => s.setMode);
  const navigateToTaskInput = useNavigationStore((s) => s.navigateToTaskInput);
  const Icon = project.icon;

  const handleClick = () => {
    setMode("code");
    navigateToTaskInput({ initialPrompt: project.prompt });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex flex-1 flex-col items-start gap-1 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2)"
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
  return (
    <Flex gap="2" className="w-full">
      {PROJECTS.map((p) => (
        <SampleCard key={p.title} project={p} />
      ))}
    </Flex>
  );
}
