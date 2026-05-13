import {
  ChartLineUp,
  ChatsTeardrop,
  Compass,
  Flask,
  Sparkle,
} from "@phosphor-icons/react";
import { Box, Button, Flex, HoverCard, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";

interface SuggestionCard {
  icon: ReactNode;
  title: string;
  description: string;
}

const cards: SuggestionCard[] = [
  {
    icon: <ChartLineUp size={20} weight="duotone" />,
    title: "Weekly product update",
    description: "Narrate metrics for your team every Monday",
  },
  {
    icon: <Flask size={20} weight="duotone" />,
    title: "Experiment readouts",
    description: "Draft a writeup once results reach stat-sig",
  },
  {
    icon: <ChatsTeardrop size={20} weight="duotone" />,
    title: "Customer feedback themes",
    description: "Cluster interviews and support into trends",
  },
  {
    icon: <Compass size={20} weight="duotone" />,
    title: "Roadmap brief",
    description: "Spot signals and propose what to ship next",
  },
];

function SuggestionCardItem({ card }: { card: SuggestionCard }) {
  return (
    <button
      type="button"
      className="flex flex-1 flex-col items-start gap-1 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2)"
    >
      <Box className="text-(--gray-11)">{card.icon}</Box>
      <Text as="div" weight="medium" className="text-(--gray-12) text-[13px]">
        {card.title}
      </Text>
      <Text as="div" className="text-(--gray-11) text-[12px]">
        {card.description}
      </Text>
    </button>
  );
}

export function WorkSuggestionsHoverCard() {
  return (
    <HoverCard.Root openDelay={120} closeDelay={150}>
      <HoverCard.Trigger>
        <Button
          variant="soft"
          color="gray"
          size="1"
          className="cursor-pointer gap-1"
          type="button"
        >
          <Sparkle size={12} weight="duotone" />
          See what to try in PostHog Work
        </Button>
      </HoverCard.Trigger>
      <HoverCard.Content
        side="top"
        align="center"
        sideOffset={8}
        className="w-[600px] max-w-[90vw]"
      >
        <Flex gap="2">
          {cards.map((c) => (
            <SuggestionCardItem key={c.title} card={c} />
          ))}
        </Flex>
      </HoverCard.Content>
    </HoverCard.Root>
  );
}
