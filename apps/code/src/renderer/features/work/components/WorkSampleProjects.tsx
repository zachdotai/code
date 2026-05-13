import {
  CalendarCheck,
  ChartLineUp,
  CurrencyDollar,
  type IconProps,
  Megaphone,
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
