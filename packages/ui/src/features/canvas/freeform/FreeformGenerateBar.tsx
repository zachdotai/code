import { SparkleIcon } from "@phosphor-icons/react";
import { useGenerateFreeformCanvas } from "@posthog/ui/features/canvas/hooks/useGenerateFreeformCanvas";
import { flattenSelectOptions } from "@posthog/ui/features/sessions/sessionStore";
import { usePreviewConfig } from "@posthog/ui/features/task-detail/hooks/usePreviewConfig";
import { Button, Flex, Select, Spinner, TextArea } from "@radix-ui/themes";
import { useMemo, useState } from "react";

// Composer that kicks off freeform canvas generation as a dedicated task: the
// user describes what they want and the agent builds + publishes the canvas. No
// repo is picked up front — the agent attaches one lazily only if it needs it.
// Used both for the first build (empty canvas) and for follow-up edits
// (currentCode passed in).
export function FreeformGenerateBar({
  dashboardId,
  channelId,
  channelName,
  name,
  templateId,
  currentCode,
  value,
  onValueChange,
  onStarted,
}: {
  dashboardId: string;
  channelId: string;
  channelName: string;
  name: string;
  templateId?: string;
  currentCode?: string;
  // Controlled draft text (so a self-repair action can prefill it).
  value: string;
  onValueChange: (next: string) => void;
  onStarted?: (taskId: string) => void;
}) {
  const { generate, isStarting } = useGenerateFreeformCanvas({
    dashboardId,
    channelId,
    name,
    channelName,
    templateId,
  });
  const draft = value;
  const setDraft = onValueChange;
  const isEdit = !!currentCode?.trim();

  // Model picker for the generation task. We default to Sonnet (faster) so we
  // can compare its canvas output against the gateway default (Opus). Options
  // come from the same preview-config query the task input uses, so only models
  // the gateway actually offers are selectable.
  const { modelOption } = usePreviewConfig("claude");
  const modelOptions = useMemo(() => {
    const raw =
      modelOption?.type === "select"
        ? flattenSelectOptions(modelOption.options)
        : [];
    // ACP config values are string | boolean | number; model ids are always
    // strings, so narrow to those and drop anything unexpected.
    return raw.flatMap((m) =>
      typeof m.value === "string" ? [{ value: m.value, name: m.name }] : [],
    );
  }, [modelOption]);
  const defaultModel = useMemo(() => {
    const sonnet = modelOptions.find((m) => m.value.includes("sonnet"));
    const current = modelOption?.currentValue;
    return (
      sonnet?.value ?? (typeof current === "string" ? current : undefined)
    );
  }, [modelOptions, modelOption]);
  const [selectedModel, setSelectedModel] = useState<string | undefined>();
  const model = selectedModel ?? defaultModel;

  const run = async () => {
    const instruction = draft.trim();
    if (!instruction) return;
    const taskId = await generate({ instruction, currentCode, model });
    if (taskId) {
      setDraft("");
      onStarted?.(taskId);
    }
  };

  return (
    <Flex
      direction="column"
      gap="2"
      className="mx-auto w-full max-w-[480px] rounded-lg border border-gray-6 bg-gray-2 p-3"
    >
      <TextArea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={
          isEdit
            ? "Describe the change you want…"
            : "Describe the canvas you want. The agent builds a React app from your PostHog data."
        }
        rows={3}
        disabled={isStarting}
      />
      <Flex align="center" justify="between" gap="2">
        {modelOptions.length > 0 ? (
          <Select.Root
            size="1"
            value={model}
            onValueChange={setSelectedModel}
            disabled={isStarting}
          >
            <Select.Trigger variant="soft" aria-label="Generation model" />
            <Select.Content>
              {modelOptions.map((m) => (
                <Select.Item key={m.value} value={m.value}>
                  {m.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        ) : (
          <span />
        )}
        <Button
          size="2"
          variant="solid"
          disabled={!draft.trim() || isStarting}
          onClick={() => void run()}
        >
          {isStarting ? <Spinner size="1" /> : <SparkleIcon size={14} />}
          {isEdit ? "Edit" : "Generate"}
        </Button>
      </Flex>
    </Flex>
  );
}
