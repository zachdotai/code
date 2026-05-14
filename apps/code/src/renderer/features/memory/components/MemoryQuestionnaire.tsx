import { Brain, CaretRight, Plus } from "@phosphor-icons/react";
import { Box, Flex, ScrollArea, Text } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@utils/toast";
import { useState } from "react";
import {
  LongField,
  type PersonAnswer,
  PersonCard,
  renderPersonMd,
  ShortField,
  slugify,
} from "./MemoryFields";

interface Answers {
  role: string;
  basedIn: string;
  joined: string;
  activeFocus: string;
  watching: string;
  people: PersonAnswer[];
  workingStyle: string;
  handbookUrl: string;
  conversations: string;
}

const EMPTY_ANSWERS: Answers = {
  role: "",
  basedIn: "",
  joined: "",
  activeFocus: "",
  watching: "",
  people: [],
  workingStyle: "",
  handbookUrl: "",
  conversations: "",
};

interface MemoryQuestionnaireProps {
  onComplete: () => void;
  onSkip: () => void;
}

export function MemoryQuestionnaire({
  onComplete,
  onSkip,
}: MemoryQuestionnaireProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const writeMutation = useMutation(trpc.memory.write.mutationOptions());

  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [isSaving, setIsSaving] = useState(false);

  const update = <K extends keyof Answers>(key: K, value: Answers[K]) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const addPerson = () => {
    setAnswers((prev) => ({
      ...prev,
      people: [
        ...prev.people,
        { id: crypto.randomUUID(), name: "", role: "", notes: "" },
      ],
    }));
  };

  const updatePerson = (id: string, patch: Partial<PersonAnswer>) => {
    setAnswers((prev) => ({
      ...prev,
      people: prev.people.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  };

  const removePerson = (id: string) => {
    setAnswers((prev) => ({
      ...prev,
      people: prev.people.filter((p) => p.id !== id),
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const memoryMd = renderMemoryMd(answers);
      await writeMutation.mutateAsync({
        relativePath: "MEMORY.md",
        content: memoryMd,
      });

      for (const person of answers.people) {
        if (!person.name.trim()) continue;
        const slug = slugify(person.name);
        const body = renderPersonMd(person);
        await writeMutation.mutateAsync({
          relativePath: `people/${slug}.md`,
          content: body,
        });
      }

      await queryClient.invalidateQueries({ queryKey: ["memory"] });
      toast.success("Memory saved");
      onComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const canSave =
    answers.role.trim().length > 0 ||
    answers.activeFocus.trim().length > 0 ||
    answers.people.some((p) => p.name.trim().length > 0);

  return (
    <Flex direction="column" className="h-full">
      <Flex
        align="center"
        justify="between"
        px="4"
        py="3"
        className="shrink-0 border-b border-b-(--gray-5)"
      >
        <Flex align="center" gap="2">
          <Brain size={16} className="text-gray-11" />
          <Text className="font-medium text-[14px]">Set up your memory</Text>
        </Flex>
        <button
          type="button"
          onClick={onSkip}
          className="rounded px-2 py-1 text-[12px] text-gray-10 hover:bg-gray-3 hover:text-gray-11"
        >
          Skip — I'll write my own
        </button>
      </Flex>

      <ScrollArea type="auto" className="flex-1">
        <Box className="mx-auto max-w-2xl px-6 py-6">
          <Text className="mb-6 block text-[13px] text-gray-10">
            A few questions so the agent knows who you are and what you're
            working on. None are required — skip what you like. Links are
            welcome anywhere:{" "}
            <code className="rounded bg-gray-3 px-1 py-0.5 text-[11px]">
              [label](url)
            </code>{" "}
            works in every answer.
          </Text>

          <Section title="About you">
            <ShortField
              label="What's your role?"
              placeholder="e.g. VP of Sales at Acme"
              value={answers.role}
              onChange={(v) => update("role", v)}
            />
            <ShortField
              label="Where are you based?"
              placeholder="City and timezone — e.g. London (BST)"
              value={answers.basedIn}
              onChange={(v) => update("basedIn", v)}
            />
            <ShortField
              label="When did you join?"
              placeholder="Optional — e.g. 2020"
              value={answers.joined}
              onChange={(v) => update("joined", v)}
            />
          </Section>

          <Section title="What you're working on">
            <LongField
              label="What are you actively driving right now?"
              placeholder="A few bullets work great. Drop in links to dashboards, docs, or issues."
              value={answers.activeFocus}
              onChange={(v) => update("activeFocus", v)}
            />
            <LongField
              label="What are you watching but not driving?"
              placeholder="Things you keep an eye on but aren't owning."
              value={answers.watching}
              onChange={(v) => update("watching", v)}
              optional
            />
          </Section>

          <Section title="Your team">
            <Text className="mb-2 block text-[12px] text-gray-10">
              Add the people you work with most. The agent will use these to
              decode shorthand and suggest who to involve.
            </Text>
            <Flex direction="column" gap="3">
              {answers.people.map((person) => (
                <PersonCard
                  key={person.id}
                  person={person}
                  onChange={(patch) => updatePerson(person.id, patch)}
                  onRemove={() => removePerson(person.id)}
                />
              ))}
              <button
                type="button"
                onClick={addPerson}
                className="flex w-fit items-center gap-1.5 rounded border border-gray-5 border-dashed px-3 py-2 text-[12px] text-gray-10 hover:border-gray-7 hover:text-gray-11"
              >
                <Plus size={12} />
                Add a person
              </button>
            </Flex>
          </Section>

          <Section title="Working style">
            <LongField
              label="Any quirks in how you like to work?"
              placeholder={`e.g. "Tuesdays are meeting-free", "I prefer async over meetings", "BST timezone — most of my team is US-based"`}
              value={answers.workingStyle}
              onChange={(v) => update("workingStyle", v)}
              optional
            />
          </Section>

          <Section title="Where to find things">
            <ShortField
              label="Handbook, wiki, or docs URL"
              placeholder="https://yourcompany.com/handbook"
              value={answers.handbookUrl}
              onChange={(v) => update("handbookUrl", v)}
              optional
            />
            <LongField
              label="Where do important conversations happen?"
              placeholder="Slack channels, group DMs, recurring meetings — links welcome."
              value={answers.conversations}
              onChange={(v) => update("conversations", v)}
              optional
            />
          </Section>

          <Flex
            align="center"
            justify="end"
            gap="3"
            className="mt-4 border-t border-t-(--gray-5) pt-4"
          >
            <button
              type="button"
              onClick={onSkip}
              className="rounded px-3 py-1.5 text-[13px] text-gray-10 hover:bg-gray-3 hover:text-gray-11"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || isSaving}
              className="flex items-center gap-1.5 rounded bg-gray-12 px-4 py-1.5 text-[13px] text-gray-1 hover:opacity-90 disabled:opacity-40"
            >
              Save memory
              <CaretRight size={12} />
            </button>
          </Flex>
        </Box>
      </ScrollArea>
    </Flex>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box className="mb-7">
      <Text className="mb-3 block font-medium text-[13px] text-gray-12">
        {title}
      </Text>
      <Flex direction="column" gap="3">
        {children}
      </Flex>
    </Box>
  );
}

function renderMemoryMd(a: Answers): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push("name: Memory Index");
  lines.push("description: Personal memory index");
  lines.push("type: context");
  lines.push("---");
  lines.push("");
  lines.push("# Memory");
  lines.push("");

  if (a.role || a.basedIn || a.joined) {
    lines.push("## Me");
    lines.push("");
    if (a.role) lines.push(`- ${a.role}`);
    if (a.basedIn) lines.push(`- Based in ${a.basedIn}`);
    if (a.joined) lines.push(`- Joined ${a.joined}`);
    lines.push("");
  }

  if (a.activeFocus || a.watching) {
    lines.push("## Current focus");
    lines.push("");
    if (a.activeFocus) {
      lines.push("**Driving:**");
      lines.push("");
      lines.push(a.activeFocus.trim());
      lines.push("");
    }
    if (a.watching) {
      lines.push("**Watching:**");
      lines.push("");
      lines.push(a.watching.trim());
      lines.push("");
    }
  }

  if (a.workingStyle) {
    lines.push("## Working style");
    lines.push("");
    lines.push(a.workingStyle.trim());
    lines.push("");
  }

  if (a.handbookUrl || a.conversations) {
    lines.push("## Where to find things");
    lines.push("");
    if (a.handbookUrl) {
      lines.push(`- Handbook: ${a.handbookUrl}`);
      lines.push("");
    }
    if (a.conversations) {
      lines.push(a.conversations.trim());
      lines.push("");
    }
  }

  return lines.join("\n");
}
