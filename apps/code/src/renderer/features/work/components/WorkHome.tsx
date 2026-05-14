import { Box, Flex, Text } from "@radix-ui/themes";
import beachHog from "@renderer/assets/images/hedgehogs/beach-hog.png";
import builderHog from "@renderer/assets/images/hedgehogs/builder-hog-03.png";
import cursorHog from "@renderer/assets/images/hedgehogs/cursor-hog.png";
import detectiveHog from "@renderer/assets/images/hedgehogs/detective-hog.png";
import experimentsHog from "@renderer/assets/images/hedgehogs/experiments-hog.png";
import explorerHog from "@renderer/assets/images/hedgehogs/explorer-hog.png";
import featureFlagHog from "@renderer/assets/images/hedgehogs/feature-flag-hog.png";
import fileHog from "@renderer/assets/images/hedgehogs/file-hog.png";
import graphsHog from "@renderer/assets/images/hedgehogs/graphs-hog.png";
import hackerHog from "@renderer/assets/images/hedgehogs/hacker-hog.png";
import happyHog from "@renderer/assets/images/hedgehogs/happy-hog.png";
import partyHog from "@renderer/assets/images/hedgehogs/party-hog.png";
import meepUrl from "@renderer/assets/sounds/meep.mp3";
import type { CSSProperties } from "react";
import { useMemo, useRef, useState } from "react";
import { WorkTemplateRail } from "../templates/WorkTemplateRail";
import { WorkHomePrompt } from "./WorkHomePrompt";
import { WorkPinnedProjects, WorkRecentProjects } from "./WorkRecentProjects";
import { WorkSampleProjects } from "./WorkSampleProjects";

const HOGS: { image: string; messages: string[] }[] = [
  {
    image: beachHog,
    messages: [
      "Hello normie, ready for a chill one?",
      "Heya normie, what's washing up today?",
      "Hola normie, sand or screens today?",
      "Aloha normie — what are we cooking up before the tide turns?",
      "Tide's coming in, normie. Where do we paddle out?",
      "Out of office, normie. Let's make something worth coming back to.",
      "Tide's high, normie — give me a click.",
    ],
  },
  {
    image: builderHog,
    messages: [
      "Hello normie, what are we building today?",
      "Heya normie, got the blueprints ready?",
      "Hard hats on, normie — what's first up?",
      "Howdy normie, what wing of the empire shall we frame today?",
      "Tools sharpened, normie. What are we putting up?",
      "I'm fully caffeinated, normie. What are we constructing?",
      "Tap me, normie. We'll break ground after.",
    ],
  },
  {
    image: cursorHog,
    messages: [
      "Hello normie, where shall we point today?",
      "Heya normie, the cursor's blinking — what's next?",
      "Hola normie, ready to chase that pointer?",
      "Howdy normie, where do you want this cursor parked?",
      "Cursor's hot, normie. Where do I go?",
      "Steady your hand, normie. I'll follow wherever you point.",
      "Aim the cursor here, normie. Click.",
    ],
  },
  {
    image: detectiveHog,
    messages: [
      "Hello normie, what mystery are we solving today?",
      "Heya normie, got a case for me?",
      "Hola normie, what needs investigating?",
      "Pipe lit, normie. What's the case?",
      "The trail is warm, normie. Where do we start digging?",
      "Talk, normie — who did it and why?",
      "Click me, normie. Let's crack the case.",
    ],
  },
  {
    image: experimentsHog,
    messages: [
      "Hello normie, ready to test a hypothesis?",
      "Hola normie, what shall we experiment with today?",
      "Heya normie, got a variant on your mind?",
      "Lab's open, normie — what are we A/B-ing?",
      "Goggles on, normie. What are we testing?",
      "Step into the lab, normie. Let's run something bold.",
      "Click me, normie. You might be in the test group.",
    ],
  },
  {
    image: explorerHog,
    messages: [
      "Hello normie, where shall we explore today?",
      "Heya normie, got a map for me?",
      "Hola normie, what's beyond the horizon today?",
      "Howdy normie, which corner of the map are we filling in?",
      "Pack's loaded, normie. Where to?",
      "Compass is spinning, normie. Let's head somewhere new.",
      "Tap me, normie. Let's see what's over the ridge.",
    ],
  },
  {
    image: featureFlagHog,
    messages: [
      "Hello normie, what shall we roll out today?",
      "Heya normie, ready to flip a flag?",
      "Hola normie, what feature wants the green light?",
      "Howdy normie, who are we rolling out to today?",
      "Flag's in my hand, normie. Where do we ship it?",
      "Roll the dice, normie — who gets the new toy first?",
      "Click me, normie. You hold the flag.",
    ],
  },
  {
    image: fileHog,
    messages: [
      "Hello normie, which file shall we crack open?",
      "Heya normie, what's in the inbox today?",
      "Hola normie, got a file that needs love?",
      "Howdy normie, what document needs taming?",
      "Drawers are open, normie. What are we filing?",
      "Hand me the folder, normie. I'll sort the lot.",
      "Click me, normie. Top of the inbox.",
    ],
  },
  {
    image: graphsHog,
    messages: [
      "Hello normie, what shall we measure today?",
      "Heya normie, got numbers that need a closer look?",
      "Hola normie, what's the chart trying to tell us?",
      "Howdy normie, which metric is misbehaving?",
      "Pull up the dashboard, normie. What's odd?",
      "Point at the spike, normie — let's figure out what happened.",
      "Click me, normie. The line goes up from here.",
    ],
  },
  {
    image: hackerHog,
    messages: [
      "Hello normie, ready to ship some code?",
      "Heya normie, what's the mission?",
      "Hola normie, what are we hacking on today?",
      "Yo normie, terminal's open — what's the play?",
      "Boot's hot, normie. What's the target?",
      "I'm in, normie. Now what?",
      "Click me, normie. We're in.",
    ],
  },
  {
    image: happyHog,
    messages: [
      "Hello normie, what can I do for you today?",
      "Heya normie, what's first on the list?",
      "Hola normie, what shall we get done?",
      "Howdy normie, what's the play?",
      "Bring it on, normie. What's first?",
      "I'm wide awake, normie. Where do we start?",
      "Psst normie, give me a click.",
    ],
  },
  {
    image: partyHog,
    messages: [
      "Hello normie, what are we celebrating today?",
      "Heya normie, ready to make a little noise?",
      "Hola normie, the music's on — what's the plan?",
      "Howdy normie, who are we throwing this for?",
      "Cake's in the oven, normie. What's the occasion?",
      "Bring the streamers, normie. Tonight we ship and toast.",
      "Go on, normie — click me, I won't bite.",
    ],
  },
];

const HOG_CLICK_COOLDOWN_MS = 5000;
const HOG_SPIN_DURATION_MS = 700;

export function WorkHome() {
  const { hog, message, floatStyle } = useMemo(() => {
    const picked = HOGS[Math.floor(Math.random() * HOGS.length)];
    const pickedMessage =
      picked.messages[Math.floor(Math.random() * picked.messages.length)];
    const duration = 2.8 + Math.random() * 2; // 2.8s – 4.8s
    const amplitude = -(3 + Math.random() * 5); // -3px to -8px
    const delay = -Math.random() * duration; // desync the cycle phase
    return {
      hog: picked.image,
      message: pickedMessage,
      floatStyle: {
        "--pool-duration": `${duration.toFixed(2)}s`,
        "--pool-y": `${amplitude.toFixed(2)}px`,
        "--pool-delay": `${delay.toFixed(2)}s`,
      } as CSSProperties,
    };
  }, []);

  const [spinning, setSpinning] = useState(false);
  const lastClickRef = useRef(0);

  const handleHogClick = () => {
    const now = Date.now();
    if (now - lastClickRef.current < HOG_CLICK_COOLDOWN_MS) return;
    lastClickRef.current = now;
    setSpinning(true);
    const audio = new Audio(meepUrl);
    audio.volume = 0.7;
    audio.play().catch(() => {});
    window.setTimeout(() => setSpinning(false), HOG_SPIN_DURATION_MS);
  };

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
          <button
            type="button"
            onClick={handleHogClick}
            aria-label="Pet the hedgehog"
            className="pool-float cursor-pointer border-0 bg-transparent p-0 outline-none [perspective:600px]"
            style={floatStyle}
          >
            <img
              src={hog}
              alt=""
              className={`h-28 w-auto select-none ${spinning ? "hog-spin" : ""}`}
              draggable={false}
            />
          </button>
          <Box className="text-center">
            <Text
              as="div"
              weight="medium"
              className="whitespace-nowrap text-(--gray-12) text-[22px]"
            >
              {message}
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
