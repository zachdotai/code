import { WorkSuggestionsHoverCard } from "@features/sessions/components/WorkSuggestionsHoverCard";
import { Box, Flex, Text } from "@radix-ui/themes";
import hackerHog from "@renderer/assets/images/hedgehogs/hacker-hog.png";

export function WorkView() {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      className="h-full w-full"
      gap="3"
    >
      <img
        src={hackerHog}
        alt=""
        className="h-40 w-auto select-none"
        draggable={false}
      />
      <Box className="text-center">
        <Text as="div" weight="medium" className="text-(--gray-12) text-[18px]">
          PostHog Work
        </Text>
        <Text as="div" className="text-(--gray-11) text-[13px]">
          Set up recurring projects with the context PostHog already has.
        </Text>
      </Box>
      <WorkSuggestionsHoverCard />
    </Flex>
  );
}
