import {
  ArrowSquareOut,
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
import { Box, Dialog, Flex, SegmentedControl, Text } from "@radix-ui/themes";
import generalistImg from "@renderer/assets/images/personalities/blank.png";
import builderImg from "@renderer/assets/images/personalities/data.png";
import operatorImg from "@renderer/assets/images/personalities/operator.png";
import closerImg from "@renderer/assets/images/personalities/sales.png";
import listenerImg from "@renderer/assets/images/personalities/support.png";
import { useNavigationStore } from "@stores/navigationStore";
import { openUrlInBrowser } from "@utils/browser";
import { type ComponentType, useEffect, useState } from "react";

const TEAM_SKILLS_LIBRARY_URL =
  "https://app.posthog.com/project/2/llm-analytics/skills";

const EXTERNAL_SKILLS_SEARCH_URL = "https://skills.sh";

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
  action,
}: {
  label: string;
  hint: string;
  skills: Skill[];
  variant: "active" | "library";
  action?: React.ReactNode;
}) {
  return (
    <Box className="w-full">
      <Flex align="center" justify="between" gap="2" className="mb-2">
        <Flex align="baseline" gap="2">
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
        {action}
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

type PersonalityId = "product" | "growth" | "sales" | "customer" | "mixed";

interface SkillPersonality {
  id: PersonalityId;
  name: string;
  tagline: string;
  body: string;
  teamBody: string;
  hog: string;
}

const PERSONALITIES: Record<PersonalityId, SkillPersonality> = {
  product: {
    id: "product",
    name: "The Builder",
    tagline: "Ship first, name it later.",
    body: "You'd rather merge a branch than open a Notion doc. Adoption curves get you out of bed. The roadmap is wherever the last good idea landed.",
    teamBody:
      "Your team merges before it writes specs. The roadmap is whatever was on the whiteboard yesterday. Velocity > planning, until it isn't.",
    hog: builderImg,
  },
  growth: {
    id: "growth",
    name: "The Operator",
    tagline: "Funnels in your head, conversion on your tongue.",
    body: "You measure what others romanticize. If a channel can't be attributed, it doesn't exist. Your friends are a little tired of hearing about LTV.",
    teamBody:
      "Your team treats dashboards as decision tools, not decoration. Anything not measured doesn't ship. Channel attribution is the love language.",
    hog: operatorImg,
  },
  sales: {
    id: "sales",
    name: "The Closer",
    tagline: "Pipeline is a verb.",
    body: "You read a deal cycle like a stack trace. CRM open in one tab, Slack in another, energy drink in hand. You ship the deal and the postmortem.",
    teamBody:
      "Your team can pull pipeline at 2am. Every customer call has a follow-up by EOD. The deal is also the product.",
    hog: closerImg,
  },
  customer: {
    id: "customer",
    name: "The Listener",
    tagline: "Support is product research in disguise.",
    body: "You treat threads like primary sources. The truth lives in transcripts and #feedback, not in roadmap docs. People keep shipping what you told them to.",
    teamBody:
      "Your team reads the support inbox like a roadmap. Truth pipes from #feedback to PRs. Customers are everyone's job, not a department.",
    hog: listenerImg,
  },
  mixed: {
    id: "mixed",
    name: "The Generalist",
    tagline: "Everything is your job and nothing is your specialty.",
    body: "You context-switch faster than your laptop does. Beware: you will be asked to do all of it forever.",
    teamBody:
      "Your team is small enough that everyone touches everything. Job descriptions are a suggestion. Bus factor of one, hat count of many.",
    hog: generalistImg,
  },
};

const PERSONALITY_ORDER: PersonalityId[] = [
  "product",
  "growth",
  "sales",
  "customer",
  "mixed",
];

function computePersonality(skills: Skill[]): SkillPersonality {
  const counts: Record<SkillTag, number> = {
    product: 0,
    growth: 0,
    sales: 0,
    customer: 0,
    reporting: 0,
  };
  for (const skill of skills) {
    for (const tag of skill.tags) {
      counts[tag]++;
    }
  }
  let top: SkillTag | null = null;
  let topCount = 0;
  let tied = false;
  for (const tag of TAG_ORDER) {
    if (counts[tag] > topCount) {
      top = tag;
      topCount = counts[tag];
      tied = false;
    } else if (counts[tag] === topCount && top !== null) {
      tied = true;
    }
  }
  if (top === null || topCount === 0 || tied || top === "reporting") {
    return PERSONALITIES.mixed;
  }
  return PERSONALITIES[top];
}

type PersonalitySubject = "you" | "team";

function SkillsPersonalityDialog({
  open,
  onOpenChange,
  personality,
  subject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personality: SkillPersonality;
  subject: PersonalitySubject;
}) {
  const [view, setView] = useState<"result" | "gallery">("result");
  const [viewingId, setViewingId] = useState<PersonalityId>(personality.id);

  useEffect(() => {
    if (open) {
      setView("result");
      setViewingId(personality.id);
    }
  }, [open, personality.id]);

  const viewing = PERSONALITIES[viewingId];
  const isOwn = viewing.id === personality.id;
  const eyebrow = isOwn
    ? subject === "team"
      ? "Your team's skills personality"
      : "Your skills personality"
    : "Skills personality";
  const body = subject === "team" ? viewing.teamBody : viewing.body;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="520px" size="2" className="relative">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
          className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-(--radius-2) text-(--gray-10) transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
        >
          <X size={14} weight="bold" />
        </button>
        {view === "result" ? (
          <Flex direction="column" align="center" gap="4" className="py-2">
            <img
              src={viewing.hog}
              alt=""
              className="h-28 w-auto select-none"
              draggable={false}
            />
            <Flex direction="column" align="center" gap="1">
              <Text
                as="div"
                className="text-(--gray-10) text-[11px] uppercase tracking-wide"
              >
                {eyebrow}
              </Text>
              <Text
                as="div"
                weight="medium"
                className="text-(--gray-12) text-[22px]"
              >
                {viewing.name}
              </Text>
              <Text
                as="div"
                className="text-center text-(--gray-11) text-[13px] italic"
              >
                {viewing.tagline}
              </Text>
            </Flex>
            <Text
              as="div"
              className="text-center text-(--gray-11) text-[13px] leading-snug"
            >
              {body}
            </Text>
            <Flex direction="column" align="center" gap="2" className="mt-1">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-(--radius-2) bg-(--gray-12) px-3 py-1 font-medium text-(--gray-1) text-[12px]"
              >
                Live with it
              </button>
              <button
                type="button"
                onClick={() => setView("gallery")}
                className="text-(--gray-10) text-[12px] italic underline-offset-2 transition-colors hover:text-(--gray-11) hover:underline"
              >
                See the others
              </button>
            </Flex>
          </Flex>
        ) : (
          <Flex direction="column" gap="3" className="py-1">
            <button
              type="button"
              onClick={() => setView("result")}
              className="self-start text-(--gray-11) text-[12px] underline-offset-2 hover:text-(--gray-12) hover:underline"
            >
              ← Back
            </button>
            <Flex direction="column" gap="2">
              {PERSONALITY_ORDER.map((id) => {
                const p = PERSONALITIES[id];
                const isYou = p.id === personality.id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setViewingId(p.id);
                      setView("result");
                    }}
                    className={`flex items-center gap-3 rounded-(--radius-3) border p-2.5 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) ${
                      isYou
                        ? "border-(--gray-7) bg-(--gray-2)"
                        : "border-(--gray-5) bg-(--gray-1)"
                    }`}
                  >
                    <img
                      src={p.hog}
                      alt=""
                      className="h-12 w-12 shrink-0 select-none object-contain"
                      draggable={false}
                    />
                    <Box className="min-w-0 flex-1">
                      <Flex align="center" gap="2">
                        <Text
                          as="span"
                          weight="medium"
                          className="text-(--gray-12) text-[13px]"
                        >
                          {p.name}
                        </Text>
                        {isYou && (
                          <Text
                            as="span"
                            className="rounded-(--radius-1) bg-(--gray-12) px-1.5 py-0.5 text-(--gray-1) text-[10px] uppercase tracking-wide"
                          >
                            {subject === "team" ? "Team" : "You"}
                          </Text>
                        )}
                      </Flex>
                      <Text
                        as="div"
                        className="text-(--gray-11) text-[12px] italic"
                      >
                        {p.tagline}
                      </Text>
                    </Box>
                  </button>
                );
              })}
            </Flex>
          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function WorkSkillsView() {
  const [scope, setScope] = useState<SkillScope>("user");
  const [tagFilter, setTagFilter] = useState<TagFilter>("all");
  const [personalityOpen, setPersonalityOpen] = useState(false);
  const [personalitySubject, setPersonalitySubject] =
    useState<PersonalitySubject>("you");
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

  const personalYou = computePersonality([
    ...SKILLS.user.active,
    ...SKILLS.user.library,
  ]);
  const personalTeam = computePersonality([
    ...SKILLS.team.active,
    ...SKILLS.team.library,
  ]);

  const activePersonality =
    personalitySubject === "team" ? personalTeam : personalYou;

  const openPersonality = (subject: PersonalitySubject) => {
    setPersonalitySubject(subject);
    setPersonalityOpen(true);
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

        <Flex align="center" justify="between" gap="3" wrap="wrap">
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

          {scope === "team" && (
            <button
              type="button"
              onClick={() => openUrlInBrowser(TEAM_SKILLS_LIBRARY_URL)}
              title="Open the team skills library in PostHog Cloud"
              className="flex items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2.5 py-1 text-(--gray-11) text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) hover:text-(--gray-12)"
            >
              Manage in PostHog
              <ArrowSquareOut size={12} weight="bold" />
            </button>
          )}
        </Flex>

        {scope === "team" && (
          <button
            type="button"
            onClick={() => openPersonality("team")}
            className="flex items-center gap-3 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-2.5 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2)"
          >
            <img
              src={personalTeam.hog}
              alt=""
              className="h-10 w-10 shrink-0 select-none object-contain"
              draggable={false}
            />
            <Box className="min-w-0 flex-1">
              <Text
                as="div"
                className="text-(--gray-10) text-[11px] uppercase tracking-wide"
              >
                Your team is
              </Text>
              <Flex align="baseline" gap="2" wrap="wrap">
                <Text
                  as="span"
                  weight="medium"
                  className="text-(--gray-12) text-[14px]"
                >
                  {personalTeam.name}
                </Text>
                <Text as="span" className="text-(--gray-11) text-[12px] italic">
                  {personalTeam.tagline}
                </Text>
              </Flex>
            </Box>
            <Text
              as="span"
              className="shrink-0 text-(--gray-10) text-[12px] underline-offset-2"
            >
              See why
            </Text>
          </button>
        )}

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
          action={
            <button
              type="button"
              onClick={() => openUrlInBrowser(EXTERNAL_SKILLS_SEARCH_URL)}
              title="Browse community skill libraries like skills.sh"
              className="flex items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2 py-1 text-(--gray-11) text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) hover:text-(--gray-12)"
            >
              Search skills.sh
              <ArrowSquareOut size={12} weight="bold" />
            </button>
          }
        />

        <Box className="mt-2 border-(--gray-5) border-t pt-4">
          <button
            type="button"
            onClick={handleOpenCodeSkills}
            className="text-(--gray-10) text-[12px] underline-offset-2 transition-colors hover:text-(--gray-11) hover:underline"
          >
            Looking for coding skills? Manage them in PostHog Code → Skills.
          </button>
          <Box className="mt-2">
            <button
              type="button"
              onClick={() => openPersonality("you")}
              className="text-(--gray-10) text-[12px] italic underline-offset-2 transition-colors hover:text-(--gray-11) hover:underline"
            >
              What does your skill mix say about you?
            </button>
          </Box>
        </Box>
      </Flex>
      <SkillsPersonalityDialog
        open={personalityOpen}
        onOpenChange={setPersonalityOpen}
        personality={activePersonality}
        subject={personalitySubject}
      />
    </Box>
  );
}
