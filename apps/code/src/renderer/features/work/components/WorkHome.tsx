import { Box, Flex, Text } from "@radix-ui/themes";
import beachHog from "@renderer/assets/images/hedgehogs/beach-hog.png";
import { useMemo } from "react";
import { WorkTemplateRail } from "../templates/WorkTemplateRail";
import { WorkHomePrompt } from "./WorkHomePrompt";
import { WorkPinnedProjects, WorkRecentProjects } from "./WorkRecentProjects";
import { WorkSampleProjects } from "./WorkSampleProjects";

const GREETINGS = [
  "Hello",
  "Howdy",
  "Greetings",
  "Salutations",
  "Ahoy",
  "Yo",
  "Sup",
  "Oi",
  "Hark",
  "Behold",
  "Well met",
  "Wotcher",
  "Bonjour",
  "Hola",
  "Ciao",
  "Aloha",
  "G'day",
  "Heya",
  "Hiya",
  "Konnichiwa",
  "Top of the morning",
  "Howdy-do",
  "Yoo-hoo",
  "Ahoy-hoy",
  "Greetings and salutations",
];

export function WorkHome() {
  const greeting = useMemo(
    () => GREETINGS[Math.floor(Math.random() * GREETINGS.length)],
    [],
  );

  return (
    <Box className="scrollbar-overlay-y h-full w-full overflow-y-auto">
      <Flex
        direction="column"
        align="center"
        gap="6"
        className="mx-auto w-full max-w-[680px] px-6 pt-16 pb-12"
      >
        <Flex
          direction="column"
          align="center"
          gap="3"
          className="work-enter work-enter-1"
        >
          <img
            src={beachHog}
            alt=""
            className="h-28 w-auto select-none"
            draggable={false}
          />
          <Box className="text-center">
            <Text
              as="div"
              weight="medium"
              className="text-(--gray-12) text-[22px]"
            >
              {greeting} normie, what can I do for you today?
            </Text>
          </Box>
        </Flex>

        <Box className="work-enter work-enter-2 w-full">
          <WorkHomePrompt />
        </Box>

        <Box className="work-enter work-enter-3 w-full">
          <WorkPinnedProjects />
        </Box>

        <Box className="work-enter work-enter-3 w-full">
          <WorkTemplateRail />
        </Box>

        <Box className="work-enter work-enter-4 w-full">
          <WorkRecentProjects />
        </Box>

        <Box className="work-enter work-enter-4 w-full">
          <Text
            as="div"
            className="mb-2 text-center text-(--gray-10) text-[11px] uppercase tracking-wide"
          >
            Or fire a quick task
          </Text>
          <WorkSampleProjects />
        </Box>
      </Flex>
    </Box>
  );
}
