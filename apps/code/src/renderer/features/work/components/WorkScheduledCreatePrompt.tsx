import { PromptInput } from "@features/message-editor/components/PromptInput";
import { ReasoningLevelSelector } from "@features/sessions/components/ReasoningLevelSelector";
import { UnifiedModelSelector } from "@features/sessions/components/UnifiedModelSelector";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { ArrowLeft, ClockCounterClockwise } from "@phosphor-icons/react";
import { Box, Button, Flex, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import { useCallback } from "react";
import { usePreviewConfig } from "../../task-detail/hooks/usePreviewConfig";
import { useWorkStore } from "../stores/workStore";

const SCHEDULED_CREATE_SESSION_ID = "work-scheduled-create";

/**
 * Entry point for creating a new scheduled task. Renders the same rich
 * PromptInput used by Code-mode task creation — including model and
 * reasoning-effort selectors — so the experience matches "create a new task".
 * Submitting seeds a pending draft (with a default name derived from the
 * prompt) and routes to the editor with the prompt body pre-filled; the user
 * picks the schedule and data sources from there.
 *
 * Phase 2 (not yet wired): replace the editor hand-off with a Work-mode
 * chat where an agent — guided by the `skill-writer` skill — collaborates
 * with the user to draft the schedule/prompt/sources and commits the
 * scheduled task via a `create_scheduled_task` tool call.
 */
function deriveDefaultName(prompt: string): string {
  const firstLine = prompt.split(/\n+/)[0]?.trim() ?? "";
  const firstSentence = firstLine.split(/(?<=[.!?])\s+/)[0] ?? firstLine;
  const candidate = firstSentence || firstLine;
  if (candidate.length <= 60) return candidate;
  return `${candidate.slice(0, 57).trimEnd()}…`;
}

export function WorkScheduledCreatePrompt() {
  const navigateToScheduledCreate = useNavigationStore(
    (s) => s.navigateToWorkScheduledCreate,
  );
  const navigateToScheduledList = useNavigationStore(
    (s) => s.navigateToWorkScheduledList,
  );
  const setPendingCreateDraft = useWorkStore((s) => s.setPendingCreateDraft);

  const { lastUsedAdapter, setLastUsedAdapter, setLastUsedReasoningEffort } =
    useSettingsStore();
  const adapter = lastUsedAdapter ?? "claude";
  const {
    modelOption,
    thoughtOption,
    isLoading: isPreviewLoading,
    setConfigOption,
  } = usePreviewConfig(adapter);

  const handleModelChange = useCallback(
    (value: string) => {
      if (modelOption) setConfigOption(modelOption.id, value);
    },
    [modelOption, setConfigOption],
  );

  const handleThoughtChange = useCallback(
    (value: string) => {
      if (thoughtOption) {
        setConfigOption(thoughtOption.id, value);
        setLastUsedReasoningEffort(value);
      }
    },
    [thoughtOption, setConfigOption, setLastUsedReasoningEffort],
  );

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setPendingCreateDraft({
        name: deriveDefaultName(trimmed),
        prompt: trimmed,
      });
      navigateToScheduledCreate();
    },
    [navigateToScheduledCreate, setPendingCreateDraft],
  );

  return (
    <Flex direction="column" height="100%" className="overflow-hidden">
      <Flex
        align="center"
        justify="between"
        px="4"
        py="3"
        className="shrink-0 border-(--gray-6) border-b"
      >
        <Flex align="center" gap="2">
          <Button size="1" variant="ghost" onClick={navigateToScheduledList}>
            <ArrowLeft size={14} />
            Back
          </Button>
          <Text size="3" weight="medium" className="text-(--gray-12)">
            New scheduled task
          </Text>
        </Flex>
      </Flex>
      <Box className="scrollbar-overlay-y min-h-0 flex-1 overflow-y-auto">
        <Flex
          direction="column"
          align="center"
          gap="6"
          className="mx-auto w-full max-w-[680px] px-6 pt-16 pb-12"
        >
          <Flex direction="column" align="center" gap="3">
            <Flex
              align="center"
              justify="center"
              className="size-12 rounded-full bg-(--gray-3) text-(--gray-11)"
            >
              <ClockCounterClockwise size={24} weight="duotone" />
            </Flex>
            <Box className="text-center">
              <Text
                as="div"
                weight="medium"
                className="text-(--gray-12) text-[22px]"
              >
                What should we run on a schedule?
              </Text>
              <Text as="div" size="2" className="mt-1 text-(--gray-10)">
                Describe the task in plain English — we'll help you pick a
                schedule and the data sources it should reach for.
              </Text>
            </Box>
          </Flex>

          <Box className="w-full">
            <PromptInput
              sessionId={SCHEDULED_CREATE_SESSION_ID}
              placeholder="e.g. Every Monday morning, summarise last week's top errors and post a Slack digest…"
              autoFocus
              clearOnSubmit
              editorHeight="large"
              enableCommands={false}
              enableBashMode={false}
              modelSelector={
                <UnifiedModelSelector
                  modelOption={modelOption}
                  adapter={adapter}
                  onAdapterChange={setLastUsedAdapter}
                  disabled={isPreviewLoading}
                  isConnecting={isPreviewLoading}
                  onModelChange={handleModelChange}
                />
              }
              reasoningSelector={
                !isPreviewLoading && (
                  <ReasoningLevelSelector
                    thoughtOption={thoughtOption}
                    adapter={adapter}
                    onChange={handleThoughtChange}
                  />
                )
              }
              onSubmit={handleSubmit}
            />
          </Box>
        </Flex>
      </Box>
    </Flex>
  );
}
