import {
  ArrowSquareOut,
  CalendarCheck,
  ChartLineUp,
  Compass,
  CurrencyDollar,
  Gear,
  Hash,
  type IconProps,
  Lightbulb,
  Megaphone,
  Palette,
  Plus,
  Scales,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { Box, Dialog, Flex, SegmentedControl, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import { useWorkSkillsStore } from "@stores/workSkillsStore";
import { openUrlInBrowser } from "@utils/browser";
import { type ComponentType, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { type CatalogSkill, getUserCatalog } from "../data/skillsCatalog";
import {
  AXIS_LABEL,
  AXIS_ORDER,
  computeStarMap,
  type StarAxis,
  type StarMapScores,
} from "../utils/computeStarMap";
import { SkillsStarMap, SkillsStarMapMini } from "./SkillsStarMap";

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

interface TeamSkill {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
  tags: SkillTag[];
}

/**
 * Team-scope skills live in PostHog Cloud — the in-app cards are decorative
 * pointers; the "Manage in PostHog" link is the canonical surface.
 */
const TEAM_SKILLS: { active: TeamSkill[]; library: TeamSkill[] } = {
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

interface SkillCardProps {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
  isActive: boolean;
  onToggle?: () => void;
  onOpen?: () => void;
}

function SkillCard({
  icon: Icon,
  title,
  description,
  isActive,
  onToggle,
  onOpen,
}: SkillCardProps) {
  const interactive = !!onOpen;
  return (
    <Flex
      align="center"
      gap="3"
      className={`rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3 transition-colors ${
        interactive
          ? "cursor-pointer hover:border-(--gray-7) hover:bg-(--gray-2)"
          : ""
      }`}
      onClick={onOpen}
    >
      <Box className="text-(--gray-11)">
        <Icon size={20} weight="duotone" />
      </Box>
      <Box className="min-w-0 flex-1">
        <Text as="div" weight="medium" className="text-(--gray-12) text-[13px]">
          {title}
        </Text>
        <Text as="div" className="text-(--gray-11) text-[12px]">
          {description}
        </Text>
      </Box>
      <button
        type="button"
        disabled={!onToggle}
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        className={`flex shrink-0 items-center gap-1 rounded-(--radius-2) border border-(--gray-5) px-2 py-1 font-medium text-[12px] transition-colors ${
          onToggle
            ? "hover:border-(--gray-7) hover:bg-(--gray-2)"
            : "opacity-60"
        } ${isActive ? "text-(--gray-11)" : "text-(--gray-12)"}`}
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
  count,
  emptyMessage,
  action,
  children,
}: {
  label: string;
  hint: string;
  count: number;
  emptyMessage: string;
  action?: React.ReactNode;
  children: React.ReactNode;
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
            {count}
          </Text>
        </Flex>
        {action}
      </Flex>
      <Text as="div" className="mb-3 text-(--gray-11) text-[12px]">
        {hint}
      </Text>
      {count === 0 ? (
        <Box className="rounded-(--radius-3) border border-(--gray-5) border-dashed bg-(--gray-1) p-4 text-center text-(--gray-10) text-[12px]">
          {emptyMessage}
        </Box>
      ) : (
        <Flex direction="column" gap="2">
          {children}
        </Flex>
      )}
    </Box>
  );
}

const HOUR_MS = 60 * 60 * 1000;

function newSkillId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `skill-${Date.now()}`;
}

const ROLE_CRESTS: Record<StarAxis, ComponentType<IconProps>> = {
  marketing: Megaphone,
  operations: Gear,
  product: Compass,
  design: Palette,
  hr: UsersThree,
  finance: CurrencyDollar,
  legal: Scales,
};

function topAxis(scores: StarMapScores): StarAxis | null {
  if (scores.max === 0) return null;
  let best: StarAxis = AXIS_ORDER[0];
  for (const axis of AXIS_ORDER) {
    if (scores.axes[axis] > scores.axes[best]) best = axis;
  }
  return scores.axes[best] > 0 ? best : null;
}

function RoleCrests({ scores }: { scores: StarMapScores }) {
  const leader = topAxis(scores);
  return (
    <Flex align="center" justify="center" gap="2" className="w-full">
      {AXIS_ORDER.map((axis) => {
        const Icon = ROLE_CRESTS[axis];
        const isLeader = axis === leader;
        return (
          <Box
            key={axis}
            title={AXIS_LABEL[axis]}
            className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
              isLeader
                ? "border-(--orange-9) bg-(--orange-3) text-(--orange-11)"
                : "border-(--gray-5) bg-(--gray-2) text-(--gray-10)"
            }`}
          >
            <Icon size={16} weight={isLeader ? "fill" : "duotone"} />
          </Box>
        );
      })}
    </Flex>
  );
}

function formatStarMapForSlack(scores: StarMapScores): string {
  const tagline = starMapTagline(scores);
  const lines = AXIS_ORDER.map(
    (a) => `• ${AXIS_LABEL[a]}: ${scores.axes[a]}`,
  ).join("\n");
  const founder = Math.round(scores.founder * 10) / 10;
  return `*Your star map* — ${tagline}\n${lines}\n_Founder score: ${founder}_`;
}

async function copyStarMapToSlack(scores: StarMapScores): Promise<void> {
  const text = formatStarMapForSlack(scores);
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied for Slack — paste it into any channel");
  } catch {
    toast.error("Couldn't copy to clipboard");
  }
}

function starMapTagline(scores: StarMapScores): string {
  if (scores.max === 0) return "Add some skills to chart your map";
  const sorted = AXIS_ORDER.map((a) => ({
    axis: a,
    value: scores.axes[a],
  })).sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const second = sorted[1];
  if (second && top.value === second.value) {
    const balanced = sorted
      .filter((s) => s.value === top.value)
      .slice(0, 2)
      .map((s) => AXIS_LABEL[s.axis as StarAxis])
      .join(" & ");
    return `Balanced across ${balanced}`;
  }
  return `Leaning ${AXIS_LABEL[top.axis as StarAxis]}`;
}

export function WorkSkillsView() {
  const [scope, setScope] = useState<SkillScope>("user");
  const [tagFilter, setTagFilter] = useState<TagFilter>("all");
  const [lastComputedAt, setLastComputedAt] = useState(() => Date.now());
  const [starMapOpen, setStarMapOpen] = useState(false);
  const setMode = useNavigationStore((s) => s.setMode);
  const navigateToSkills = useNavigationStore((s) => s.navigateToSkills);
  const navigateToWorkSkill = useNavigationStore((s) => s.navigateToWorkSkill);
  const navigateToWorkGenerate = useNavigationStore(
    (s) => s.navigateToWorkGenerate,
  );

  const workSkills = useWorkSkillsStore((s) => s.skills);
  const addSkill = useWorkSkillsStore((s) => s.addSkill);
  const deleteSkill = useWorkSkillsStore((s) => s.deleteSkill);

  const userCatalog = useMemo(() => getUserCatalog(), []);

  // Seed defaults on first hydration only. Each defaultActive catalog entry
  // is auto-added once and recorded in seededCatalogIds; after that the user's
  // disable persists across navigations and restarts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed pulls fresh store state at mount.
  useEffect(() => {
    const state = useWorkSkillsStore.getState();
    for (const catalog of userCatalog) {
      if (!catalog.defaultActive) continue;
      if (state.seededCatalogIds.includes(catalog.id)) continue;
      if (!state.skills.some((s) => s.catalogId === catalog.id)) {
        state.addSkill({
          id: newSkillId(),
          name: catalog.title,
          prompt: catalog.prompt,
          catalogId: catalog.id,
        });
      }
      state.markSeeded(catalog.id);
    }
  }, [userCatalog]);

  const activeWorkSkillByCatalogId = useMemo(() => {
    const map = new Map<string, (typeof workSkills)[number]>();
    for (const s of workSkills) {
      if (s.catalogId) map.set(s.catalogId, s);
    }
    return map;
  }, [workSkills]);

  const matchesTag = (s: { tags: SkillTag[] }) =>
    tagFilter === "all" || s.tags.includes(tagFilter);

  const userActive = userCatalog.filter(
    (c) => activeWorkSkillByCatalogId.has(c.id) && matchesTag(c),
  );
  const userLibrary = userCatalog.filter(
    (c) => !activeWorkSkillByCatalogId.has(c.id) && matchesTag(c),
  );

  const teamActive = TEAM_SKILLS.active.filter(matchesTag);
  const teamLibrary = TEAM_SKILLS.library.filter(matchesTag);

  const handleAddCatalog = (catalog: CatalogSkill) => {
    const id = newSkillId();
    addSkill({
      id,
      name: catalog.title,
      prompt: catalog.prompt,
      catalogId: catalog.id,
    });
    navigateToWorkSkill(id);
  };

  const handleDisableCatalog = (catalogId: string) => {
    const existing = activeWorkSkillByCatalogId.get(catalogId);
    if (existing) deleteSkill(existing.id);
  };

  const handleOpenCatalog = (catalogId: string) => {
    const existing = activeWorkSkillByCatalogId.get(catalogId);
    if (existing) navigateToWorkSkill(existing.id);
  };

  const handleOpenCodeSkills = () => {
    setMode("code");
    navigateToSkills();
  };

  useEffect(() => {
    const id = setInterval(() => setLastComputedAt(Date.now()), HOUR_MS);
    return () => clearInterval(id);
  }, []);

  // Star map reflects the user's currently-active catalog skills so it shifts
  // as they toggle. When nothing is active, show the whole catalog so the
  // visualization stays populated.
  const starScores = useMemo(() => {
    const source = userActive.length > 0 ? userActive : userCatalog;
    return computeStarMap(
      source.map((s) => ({
        title: s.title,
        description: s.description,
        tags: s.tags,
      })),
    );
  }, [userActive, userCatalog]);

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

          <Flex align="center" gap="2">
            <button
              type="button"
              onClick={navigateToWorkGenerate}
              className="flex items-center gap-1 rounded-(--radius-2) border border-(--accent-7) bg-(--accent-3) px-2.5 py-1 text-(--accent-11) text-[12px] transition-colors hover:border-(--accent-8) hover:bg-(--accent-4)"
            >
              <Plus size={12} weight="bold" />
              New skill
            </button>
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
        </Flex>

        {scope === "user" && (
          <button
            type="button"
            onClick={() => setStarMapOpen(true)}
            className="flex items-center gap-3 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-2.5 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2)"
          >
            <Box className="shrink-0 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) p-1.5">
              <SkillsStarMapMini scores={starScores} size={40} />
            </Box>
            <Box className="min-w-0 flex-1">
              <Text
                as="div"
                className="text-(--gray-10) text-[11px] uppercase tracking-wide"
              >
                Your star map
              </Text>
              <Flex align="baseline" gap="2" wrap="wrap">
                <Text
                  as="span"
                  weight="medium"
                  className="text-(--gray-12) text-[14px]"
                >
                  {starMapTagline(starScores)}
                </Text>
                <Text as="span" className="text-(--gray-11) text-[12px] italic">
                  Founder {Math.round(starScores.founder * 10) / 10}
                </Text>
              </Flex>
            </Box>
            <Text
              as="span"
              className="shrink-0 text-(--gray-10) text-[12px] underline-offset-2"
            >
              See chart
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

        {scope === "user" ? (
          <>
            <SkillSection
              label="Active"
              hint="Click to open and run on demand."
              count={userActive.length}
              emptyMessage="No active skills yet — add one from the library below."
            >
              {userActive.map((c) => (
                <SkillCard
                  key={c.id}
                  icon={c.icon}
                  title={c.title}
                  description={c.description}
                  isActive
                  onToggle={() => handleDisableCatalog(c.id)}
                  onOpen={() => handleOpenCatalog(c.id)}
                />
              ))}
            </SkillSection>

            <SkillSection
              label="Library"
              hint="Available skills you haven't activated yet."
              count={userLibrary.length}
              emptyMessage="No skills match this tag."
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
            >
              {userLibrary.map((c) => (
                <SkillCard
                  key={c.id}
                  icon={c.icon}
                  title={c.title}
                  description={c.description}
                  isActive={false}
                  onToggle={() => handleAddCatalog(c)}
                />
              ))}
            </SkillSection>
          </>
        ) : (
          <>
            <SkillSection
              label="Active"
              hint="Currently running on the schedules you've set."
              count={teamActive.length}
              emptyMessage="No active team skills."
            >
              {teamActive.map((s) => (
                <SkillCard
                  key={s.title}
                  icon={s.icon}
                  title={s.title}
                  description={s.description}
                  isActive
                />
              ))}
            </SkillSection>

            <SkillSection
              label="Library"
              hint="Available skills you haven't activated yet."
              count={teamLibrary.length}
              emptyMessage="No skills match this tag."
            >
              {teamLibrary.map((s) => (
                <SkillCard
                  key={s.title}
                  icon={s.icon}
                  title={s.title}
                  description={s.description}
                  isActive={false}
                />
              ))}
            </SkillSection>
          </>
        )}

        <Box className="mt-2 border-(--gray-5) border-t pt-4">
          <button
            type="button"
            onClick={handleOpenCodeSkills}
            className="text-(--gray-10) text-[12px] underline-offset-2 transition-colors hover:text-(--gray-11) hover:underline"
          >
            Looking for coding skills? Manage them in PostHog Code → Skills.
          </button>
        </Box>
      </Flex>

      <Dialog.Root open={starMapOpen} onOpenChange={setStarMapOpen}>
        <Dialog.Content maxWidth="560px" size="3" className="relative">
          <button
            type="button"
            onClick={() => setStarMapOpen(false)}
            aria-label="Close"
            title="Close"
            className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-(--radius-2) text-(--gray-10) transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
          >
            <X size={14} weight="bold" />
          </button>
          <Flex direction="column" align="center" gap="3" className="py-2">
            <RoleCrests scores={starScores} />
            <Flex direction="column" align="center" gap="1">
              <Text
                as="div"
                className="text-(--gray-10) text-[11px] uppercase tracking-wide"
              >
                Your star map
              </Text>
              <Text
                as="div"
                weight="medium"
                className="text-(--gray-12) text-[20px]"
              >
                {starMapTagline(starScores)}
              </Text>
            </Flex>
            <Text
              as="div"
              className="mx-auto max-w-[440px] text-center text-(--gray-11) text-[13px] leading-snug"
            >
              A live read of how your skill set leans across seven everyday
              roles — Marketing, Operations, Product, Design, HR, Finance, and
              Legal — with a Founder score at the centre for the financial and
              decision-shaping work. It refreshes every hour as you add or
              activate new skills.
            </Text>
            <Box className="mt-1 w-full">
              <SkillsStarMap
                scores={starScores}
                lastComputedAt={lastComputedAt}
              />
            </Box>
            <Flex align="center" justify="center" gap="2" className="mt-1">
              <button
                type="button"
                onClick={() => copyStarMapToSlack(starScores)}
                className="flex items-center gap-1.5 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-3 py-1 font-medium text-(--gray-12) text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2)"
              >
                <Hash size={12} weight="bold" />
                Copy for Slack
              </button>
              <button
                type="button"
                onClick={() => setStarMapOpen(false)}
                className="rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-3 py-1 font-medium text-(--gray-12) text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2)"
              >
                Minimize
              </button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Box>
  );
}
