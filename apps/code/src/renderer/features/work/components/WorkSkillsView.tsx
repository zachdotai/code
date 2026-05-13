import {
  ArrowRight,
  CalendarCheck,
  ChartLineUp,
  ChatsTeardrop,
  Compass,
  CurrencyDollar,
  type IconProps,
  Lightbulb,
  Lightning,
  Megaphone,
  Plus,
  Target,
  X,
} from "@phosphor-icons/react";
import { Box, Flex, SegmentedControl, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import { type ComponentType, useState } from "react";

type SkillScope = "user" | "team";

type SkillTag = "product" | "growth" | "sales" | "customer" | "reporting";

type TagFilter = SkillTag | "all";

const TAG_META: Record<SkillTag, { label: string }> = {
  product: { label: "Product" },
  growth: { label: "Growth" },
  sales: { label: "Sales" },
  customer: { label: "Customer" },
  reporting: { label: "Reporting" },
};

const TAG_ORDER: SkillTag[] = [
  "product",
  "growth",
  "sales",
  "customer",
  "reporting",
];

interface Skill {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
  tags: SkillTag[];
}

const SKILLS: Record<SkillScope, { active: Skill[]; library: Skill[] }> = {
  user: {
    active: [
      {
        icon: CalendarCheck,
        title: "Weekly status writeup",
        description: "Drafts your Friday recap from this week's activity",
        tags: ["reporting"],
      },
      {
        icon: Megaphone,
        title: "Marketing campaign digest",
        description: "Summarizes channel performance every Monday",
        tags: ["growth"],
      },
    ],
    library: [
      {
        icon: Target,
        title: "Product-market fit tracker",
        description:
          "PMF survey, retention dashboard, and the right users to interview",
        tags: ["product", "customer"],
      },
      {
        icon: ChatsTeardrop,
        title: "Customer interview synthesis",
        description: "Clusters interview notes into recurring themes",
        tags: ["customer"],
      },
      {
        icon: Lightning,
        title: "Slack standup recap",
        description: "Turns yesterday's threads into a clean morning brief",
        tags: ["reporting"],
      },
    ],
  },
  team: {
    active: [
      {
        icon: CurrencyDollar,
        title: "Pipeline brief",
        description: "Shared with sales every Monday at 9am",
        tags: ["sales"],
      },
      {
        icon: ChartLineUp,
        title: "Feature adoption report",
        description: "Tracks adoption of recently shipped product work",
        tags: ["product"],
      },
    ],
    library: [
      {
        icon: Compass,
        title: "Roadmap proposal",
        description: "Drafts a next-quarter pitch from signals + interviews",
        tags: ["product", "customer"],
      },
      {
        icon: CalendarCheck,
        title: "Quarterly review",
        description: "Pulls KPIs, wins, and misses into a board-ready doc",
        tags: ["reporting"],
      },
    ],
  },
};

function TagFilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
        active
          ? "border-(--gray-12) bg-(--gray-12) text-(--gray-1)"
          : "border-(--gray-5) bg-(--gray-1) text-(--gray-11) hover:border-(--gray-7) hover:text-(--gray-12)"
      }`}
    >
      {label}
    </button>
  );
}

function SkillCard({
  skill,
  variant,
}: {
  skill: Skill;
  variant: "active" | "library";
}) {
  const Icon = skill.icon;
  const isActive = variant === "active";
  return (
    <Flex
      align="center"
      gap="3"
      className="rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3"
    >
      <Box className="text-(--gray-11)">
        <Icon size={20} weight="duotone" />
      </Box>
      <Box className="min-w-0 flex-1">
        <Text as="div" weight="medium" className="text-(--gray-12) text-[13px]">
          {skill.title}
        </Text>
        <Text as="div" className="text-(--gray-11) text-[12px]">
          {skill.description}
        </Text>
      </Box>
      <button
        type="button"
        className={`flex shrink-0 items-center gap-1 rounded-(--radius-2) border border-(--gray-5) px-2 py-1 font-medium text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) ${
          isActive ? "text-(--gray-11)" : "text-(--gray-12)"
        }`}
      >
        {isActive ? (
          <>
            <X size={12} weight="bold" />
            Disable
          </>
        ) : (
          <>
            <Plus size={12} weight="bold" />
            Add
          </>
        )}
      </button>
    </Flex>
  );
}

function SkillSection({
  label,
  hint,
  skills,
  variant,
}: {
  label: string;
  hint: string;
  skills: Skill[];
  variant: "active" | "library";
}) {
  return (
    <Box className="w-full">
      <Flex align="baseline" gap="2" className="mb-2">
        <Text
          as="span"
          weight="medium"
          className="text-(--gray-12) text-[13px]"
        >
          {label}
        </Text>
        <Text as="span" className="text-(--gray-10) text-[12px]">
          {skills.length}
        </Text>
      </Flex>
      <Text as="div" className="mb-3 text-(--gray-11) text-[12px]">
        {hint}
      </Text>
      {skills.length === 0 ? (
        <Box className="rounded-(--radius-3) border border-(--gray-5) border-dashed bg-(--gray-1) p-4 text-center text-(--gray-10) text-[12px]">
          No skills match this tag.
        </Box>
      ) : (
        <Flex direction="column" gap="2">
          {skills.map((s) => (
            <SkillCard key={s.title} skill={s} variant={variant} />
          ))}
        </Flex>
      )}
    </Box>
  );
}

export function WorkSkillsView() {
  const [scope, setScope] = useState<SkillScope>("user");
  const [tagFilter, setTagFilter] = useState<TagFilter>("all");
  const setMode = useNavigationStore((s) => s.setMode);
  const navigateToSkills = useNavigationStore((s) => s.navigateToSkills);

  const skills = SKILLS[scope];
  const matchesTag = (s: Skill) =>
    tagFilter === "all" || s.tags.includes(tagFilter);
  const filteredActive = skills.active.filter(matchesTag);
  const filteredLibrary = skills.library.filter(matchesTag);

  const handleOpenCodeSkills = () => {
    setMode("code");
    navigateToSkills();
  };

  return (
    <Box className="scrollbar-overlay-y h-full w-full overflow-y-auto">
      <Flex
        direction="column"
        gap="5"
        className="mx-auto w-full max-w-[760px] px-6 pt-10 pb-12"
      >
        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <Lightbulb
              size={20}
              weight="duotone"
              className="text-(--gray-11)"
            />
            <Text
              as="div"
              weight="medium"
              className="text-(--gray-12) text-[20px]"
            >
              Skills
            </Text>
          </Flex>
          <Text as="div" className="text-(--gray-11) text-[13px]">
            Reusable workflows PostHog Work runs for you. Activate the ones you
            want and add new ones from the library.
          </Text>
        </Flex>

        <SegmentedControl.Root
          value={scope}
          onValueChange={(v) => setScope(v as SkillScope)}
          size="2"
        >
          <SegmentedControl.Item value="user">
            Your skills
          </SegmentedControl.Item>
          <SegmentedControl.Item value="team">
            Team skills
          </SegmentedControl.Item>
        </SegmentedControl.Root>

        <Flex align="center" gap="2" wrap="wrap">
          <TagFilterChip
            label="All"
            active={tagFilter === "all"}
            onClick={() => setTagFilter("all")}
          />
          {TAG_ORDER.map((t) => (
            <TagFilterChip
              key={t}
              label={TAG_META[t].label}
              active={tagFilter === t}
              onClick={() => setTagFilter(t)}
            />
          ))}
        </Flex>

        <SkillSection
          label="Active"
          hint="Currently running on the schedules you've set."
          skills={filteredActive}
          variant="active"
        />

        <SkillSection
          label="Library"
          hint="Available skills you haven't activated yet."
          skills={filteredLibrary}
          variant="library"
        />

        <Box className="mt-2 border-(--gray-5) border-t pt-4">
          <button
            type="button"
            onClick={handleOpenCodeSkills}
            className="flex w-full items-center justify-between gap-2 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2)"
          >
            <Box>
              <Text
                as="div"
                weight="medium"
                className="text-(--gray-12) text-[13px]"
              >
                Looking for coding skills?
              </Text>
              <Text as="div" className="text-(--gray-11) text-[12px]">
                Manage them in PostHog Code → Skills.
              </Text>
            </Box>
            <ArrowRight
              size={14}
              weight="bold"
              className="shrink-0 text-(--gray-11)"
            />
          </button>
        </Box>
      </Flex>
    </Box>
  );
}
