import { useFolders } from "@features/folders/hooks/useFolders";
import {
  ArrowLeft,
  Bell,
  CalendarBlank,
  CaretDown,
  CaretUp,
  type IconProps,
  MagnifyingGlass,
  Sparkle,
} from "@phosphor-icons/react";
import { Box, Button, Flex, Text, TextArea, TextField } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import { useWorkSkillsStore } from "@stores/workSkillsStore";
import { type ComponentType, useCallback, useEffect, useState } from "react";
import { EXAMPLE_PROMPTS } from "../data/examplePrompts";
import { buildSkillGeneratorPrompt } from "../utils/buildSkillGeneratorPrompt";
import { runWorkSkill } from "../utils/runWorkSkill";

interface SkillTemplate {
  id: string;
  label: string;
  icon: ComponentType<IconProps>;
  name: string;
  prompt: string;
}

const TEMPLATES: SkillTemplate[] = [
  {
    id: "digest",
    label: "Recurring digest",
    icon: CalendarBlank,
    name: "Weekly [topic] digest",
    prompt: `**Goal:** [one sentence — e.g. "summarise last week's deploys and incidents for the team"]

**Trigger:** [when it runs — e.g. "every Monday at 9am" or "when I say 'send the weekly digest'"]

**Output:** [where it lands and exact shape — e.g. "5-bullet Slack message in #eng-weekly, each bullet starts with a bold headline"]

**Skip:** [explicit exclusions — e.g. "rollbacks under 5 minutes, internal-only deploys, the staging environment"]

**Data sources:** [which MCPs / tools — e.g. "PostHog MCP for error rates, Slack MCP for posting"]`,
  },
  {
    id: "investigation",
    label: "Investigation",
    icon: MagnifyingGlass,
    name: "[Question] investigation",
    prompt: `**Goal:** [one sentence — e.g. "find out why signup conversion dropped"]

**Trigger:** [when it runs — e.g. "when I say 'investigate the conversion drop'"]

**Output:** [exact shape — e.g. "a markdown report with: top hypotheses ranked, supporting numbers, suggested next experiment"]

**Skip:** [explicit exclusions — e.g. "internal users, traffic from bots, the marketing site"]

**Data sources:** [which MCPs / tools — e.g. "PostHog MCP for funnels and replays, error tracking for spikes"]`,
  },
  {
    id: "monitor",
    label: "Monitor & flag",
    icon: Bell,
    name: "[Thing to monitor] watch",
    prompt: `**Goal:** [one sentence — e.g. "flag when error rate spikes above the 7-day baseline"]

**Trigger:** [how often it checks — e.g. "every 15 minutes" or "every hour on the :05"]

**Output:** [what happens when the condition fires — e.g. "post to #alerts with the issue name, count, and a deep link; stay quiet otherwise"]

**Skip:** [what not to alert on — e.g. "known issue X, errors from the canary environment, anything below 10 occurrences"]

**Data sources:** [which MCPs / tools — e.g. "PostHog error tracking MCP, Slack MCP"]`,
  },
];

function deriveSkillName(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/)[0] ?? "";
  const trimmed = firstLine.slice(0, 60).trim();
  return trimmed || "Untitled skill";
}

function newSkillId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `skill-${Date.now()}`;
}

export function WorkGenerateView() {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inspirationOpen, setInspirationOpen] = useState(false);

  const addSkill = useWorkSkillsStore((s) => s.addSkill);
  const updateSkill = useWorkSkillsStore((s) => s.updateSkill);
  const navigateToWorkSkill = useNavigationStore((s) => s.navigateToWorkSkill);
  const navigateToWorkLibrary = useNavigationStore(
    (s) => s.navigateToWorkLibrary,
  );
  const consumeWorkGeneratePendingPrompt = useNavigationStore(
    (s) => s.consumeWorkGeneratePendingPrompt,
  );

  useEffect(() => {
    const pending = consumeWorkGeneratePendingPrompt();
    if (pending) setPrompt(pending);
  }, [consumeWorkGeneratePendingPrompt]);

  const { folders, isLoaded: foldersLoaded } = useFolders();

  const canSubmit = prompt.trim().length > 0 && !isSubmitting && foldersLoaded;

  const applyTemplate = (template: SkillTemplate) => {
    setName(template.name);
    setPrompt(template.prompt);
  };

  const applyExample = (example: (typeof EXAMPLE_PROMPTS)[number]) => {
    setName(example.name);
    setPrompt(example.prompt);
    setInspirationOpen(false);
  };

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);

    const userPrompt = prompt.trim();
    const skillId = newSkillId();
    const skillName = name.trim() || deriveSkillName(userPrompt);

    addSkill({ id: skillId, name: skillName, prompt: userPrompt });

    await runWorkSkill({
      prompt: buildSkillGeneratorPrompt(userPrompt),
      folders: folders.map((f) => f.path),
      onTaskCreated: (taskId) => {
        updateSkill(skillId, { taskId });
        navigateToWorkSkill(skillId);
      },
      failureLabel: "Failed to start skill generation",
    });

    setIsSubmitting(false);
  }, [
    canSubmit,
    prompt,
    name,
    addSkill,
    updateSkill,
    navigateToWorkSkill,
    folders,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <Box className="scrollbar-overlay-y h-full w-full overflow-y-auto">
      <Flex
        direction="column"
        gap="5"
        className="mx-auto w-full max-w-[760px] px-6 pt-6 pb-12"
      >
        <Flex align="center" justify="between" gap="2">
          <button
            type="button"
            onClick={navigateToWorkLibrary}
            className="flex items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2.5 py-1 text-(--gray-11) text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) hover:text-(--gray-12)"
          >
            <ArrowLeft size={12} weight="bold" />
            Back to skills
          </button>
        </Flex>

        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <Sparkle size={20} weight="duotone" className="text-(--gray-11)" />
            <Text
              as="div"
              weight="medium"
              className="text-(--gray-12) text-[20px]"
            >
              New skill
            </Text>
          </Flex>
          <Text as="div" className="text-(--gray-11) text-[13px]">
            Describe a reusable workflow PostHog Work can run on demand. Start
            from a structure or write it free-form.
          </Text>
        </Flex>

        <Flex direction="column" gap="2">
          <Text
            as="div"
            className="text-(--gray-10) text-[11px] uppercase tracking-wide"
          >
            Start with a structure
          </Text>
          <Flex align="center" gap="2" wrap="wrap">
            {TEMPLATES.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className="flex items-center gap-1.5 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2.5 py-1 text-(--gray-11) text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) hover:text-(--gray-12)"
                >
                  <Icon size={12} weight="duotone" />
                  {t.label}
                </button>
              );
            })}
          </Flex>
        </Flex>

        <Flex direction="column" gap="1.5">
          <Text
            as="label"
            htmlFor="work-skill-name"
            weight="medium"
            className="text-(--gray-12) text-[13px]"
          >
            Name
          </Text>
          <TextField.Root
            id="work-skill-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekly deploy digest"
            size="2"
            disabled={isSubmitting}
          />
          <Text as="div" className="text-(--gray-10) text-[12px]">
            Leave blank to derive a name from the prompt.
          </Text>
        </Flex>

        <Flex direction="column" gap="1.5">
          <Text
            as="label"
            htmlFor="work-skill-prompt"
            weight="medium"
            className="text-(--gray-12) text-[13px]"
          >
            What should it do?
          </Text>
          <TextArea
            id="work-skill-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Each Monday morning, summarise last week's deploys and any incidents."
            rows={8}
            size="2"
            disabled={isSubmitting}
            autoFocus
          />
        </Flex>

        <Flex justify="end" align="center" gap="3">
          <Text className="text-(--gray-10) text-[12px]">⌘+Enter to save</Text>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            loading={isSubmitting}
          >
            Generate skill
          </Button>
        </Flex>

        <Box className="mt-2 border-(--gray-5) border-t pt-4">
          <button
            type="button"
            onClick={() => setInspirationOpen((v) => !v)}
            className="flex items-center gap-1.5 text-(--gray-11) text-[12px] transition-colors hover:text-(--gray-12)"
          >
            <Sparkle size={12} weight="duotone" />
            Need inspiration?
            {inspirationOpen ? (
              <CaretUp size={12} weight="bold" />
            ) : (
              <CaretDown size={12} weight="bold" />
            )}
          </button>
          {inspirationOpen && (
            <Flex direction="column" gap="2" className="mt-3">
              <Text as="div" className="text-(--gray-11) text-[12px]">
                Curated starter prompts. Click one to fill the form — you can
                edit it before saving.
              </Text>
              {EXAMPLE_PROMPTS.map((ex) => {
                const Icon = ex.icon;
                return (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => applyExample(ex)}
                    className="flex items-start gap-3 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2)"
                  >
                    <Box className="shrink-0 text-(--gray-11)">
                      <Icon size={18} weight="duotone" />
                    </Box>
                    <Box className="min-w-0 flex-1">
                      <Text
                        as="div"
                        weight="medium"
                        className="text-(--gray-12) text-[13px]"
                      >
                        {ex.name}
                      </Text>
                      <Text as="div" className="text-(--gray-11) text-[12px]">
                        {ex.description}
                      </Text>
                    </Box>
                  </button>
                );
              })}
            </Flex>
          )}
        </Box>
      </Flex>
    </Box>
  );
}
