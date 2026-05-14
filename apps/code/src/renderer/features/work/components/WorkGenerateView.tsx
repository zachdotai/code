import { useFolders } from "@features/folders/hooks/useFolders";
import { Box, Button, Flex, Text, TextArea } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import { useWorkSkillsStore } from "@stores/workSkillsStore";
import { useCallback, useEffect, useState } from "react";
import { buildSkillGeneratorPrompt } from "../utils/buildSkillGeneratorPrompt";
import { runWorkSkill } from "../utils/runWorkSkill";

function deriveSkillName(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/)[0] ?? "";
  const trimmed = firstLine.slice(0, 60).trim();
  return trimmed || "Untitled skill";
}

function newSkillId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `skill-${Date.now()}`;
}

export function WorkGenerateView() {
  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addSkill = useWorkSkillsStore((s) => s.addSkill);
  const updateSkill = useWorkSkillsStore((s) => s.updateSkill);
  const navigateToWorkSkill = useNavigationStore((s) => s.navigateToWorkSkill);
  const consumeWorkGeneratePendingPrompt = useNavigationStore(
    (s) => s.consumeWorkGeneratePendingPrompt,
  );

  useEffect(() => {
    const pending = consumeWorkGeneratePendingPrompt();
    if (pending) setPrompt(pending);
  }, [consumeWorkGeneratePendingPrompt]);

  const { folders, isLoaded: foldersLoaded } = useFolders();

  const canSubmit = prompt.trim().length > 0 && !isSubmitting && foldersLoaded;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);

    const userPrompt = prompt.trim();
    const skillId = newSkillId();
    const skillName = deriveSkillName(userPrompt);

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
  }, [canSubmit, prompt, addSkill, updateSkill, navigateToWorkSkill, folders]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      className="h-full w-full"
      px="4"
    >
      <Box className="w-full max-w-[640px]">
        <Box mb="3" className="text-center">
          <Text
            as="div"
            weight="medium"
            className="text-(--gray-12) text-[18px]"
          >
            Hello, normie. Let's help you win today...
          </Text>
          <Text as="div" className="mt-1 text-(--gray-11) text-[13px]">
            Describe what the skill should do.
          </Text>
        </Box>

        <Box className="rounded-(--radius-3) border border-(--gray-5) bg-(--color-panel-solid) p-3 shadow-sm">
          <TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Each Monday morning, summarise last week's deploys and any incidents."
            rows={5}
            size="3"
            disabled={isSubmitting}
            autoFocus
          />
          <Flex justify="end" align="center" gap="2" mt="3">
            <Text className="text-(--gray-10) text-[12px]">
              ⌘+Enter to submit
            </Text>
            <Button
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              loading={isSubmitting}
            >
              Generate skill
            </Button>
          </Flex>
        </Box>
      </Box>
    </Flex>
  );
}
