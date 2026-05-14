import {
  Compass,
  Globe,
  type IconProps,
  Lightbulb,
  Lightning,
  Megaphone,
  Microphone,
  Rocket,
  Sparkle,
  Target,
  TestTube,
} from "@phosphor-icons/react";
import type { ProjectIconId } from "@shared/types/work-projects";
import type { ComponentType } from "react";

export const PROJECT_ICON_MAP: Record<
  ProjectIconId,
  ComponentType<IconProps>
> = {
  rocket: Rocket,
  microphone: Microphone,
  megaphone: Megaphone,
  lightbulb: Lightbulb,
  compass: Compass,
  target: Target,
  flask: TestTube,
  lightning: Lightning,
  sparkle: Sparkle,
  globe: Globe,
};

export const PROJECT_ICON_OPTIONS: ProjectIconId[] = [
  "rocket",
  "lightning",
  "sparkle",
  "lightbulb",
  "target",
  "compass",
  "globe",
  "megaphone",
  "microphone",
  "flask",
];
