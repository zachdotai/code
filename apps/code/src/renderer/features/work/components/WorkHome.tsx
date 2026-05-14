import { Box, Flex, Text } from "@radix-ui/themes";
import beachHog from "@renderer/assets/images/hedgehogs/beach-hog.png";
import builderHog from "@renderer/assets/images/hedgehogs/builder-hog-03.png";
import clickthatHog from "@renderer/assets/images/hedgehogs/clickthat-hog.png";
import cursorHog from "@renderer/assets/images/hedgehogs/cursor-hog.png";
import detectiveHog from "@renderer/assets/images/hedgehogs/detective-hog.png";
import experimentsHog from "@renderer/assets/images/hedgehogs/experiments-hog.png";
import explorerHog from "@renderer/assets/images/hedgehogs/explorer-hog.png";
import featureFlagHog from "@renderer/assets/images/hedgehogs/feature-flag-hog.png";
import fileHog from "@renderer/assets/images/hedgehogs/file-hog.png";
import graphsHog from "@renderer/assets/images/hedgehogs/graphs-hog.png";
import hackerHog from "@renderer/assets/images/hedgehogs/hacker-hog.png";
import happyHog from "@renderer/assets/images/hedgehogs/happy-hog.png";
import magicBookHog from "@renderer/assets/images/hedgehogs/magic-book-hog.png";
import partyHog from "@renderer/assets/images/hedgehogs/party-hog.png";
import type { CSSProperties } from "react";
import { useMemo } from "react";
import { WorkTemplateRail } from "../templates/WorkTemplateRail";
import { WorkHomePrompt } from "./WorkHomePrompt";
import { WorkPinnedProjects, WorkRecentProjects } from "./WorkRecentProjects";
import { WorkSampleProjects } from "./WorkSampleProjects";

const HOGS = [
  beachHog,
  builderHog,
  clickthatHog,
  cursorHog,
  detectiveHog,
  experimentsHog,
  explorerHog,
  featureFlagHog,
  fileHog,
  graphsHog,
  hackerHog,
  happyHog,
  magicBookHog,
  partyHog,
];

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

  const { hog, floatStyle } = useMemo(() => {
    const pickedHog = HOGS[Math.floor(Math.random() * HOGS.length)];
    const duration = 2.8 + Math.random() * 2; // 2.8s – 4.8s
    const amplitude = -(3 + Math.random() * 5); // -3px to -8px
    const delay = -Math.random() * duration; // desync the cycle phase
    return {
      hog: pickedHog,
      floatStyle: {
        "--pool-duration": `${duration.toFixed(2)}s`,
        "--pool-y": `${amplitude.toFixed(2)}px`,
        "--pool-delay": `${delay.toFixed(2)}s`,
      } as CSSProperties,
    };
  }, []);

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
          className="work-enter work-enter-1"
        >
          <div
            className="pool-float flex flex-col items-center gap-3"
            style={floatStyle}
          >
            <img
              src={hog}
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
          </div>
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
