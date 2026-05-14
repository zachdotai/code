import { flattenChatTranscript } from "@features/chat/utils/transcript";
import { useSessionForTask } from "@features/sessions/stores/sessionStore";
import { trpcClient } from "@renderer/trpc/client";
import { useNavigationStore } from "@stores/navigationStore";
import { logger } from "@utils/logger";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useWorkStore } from "../stores/workStore";

const log = logger.scope("save-chat-as-scheduled-task");

const SYSTEM_PROMPT = `You convert a chat conversation between a user and an AI assistant into a recurring scheduled task. The user has been refining what they want the assistant to do; your job is to capture the final shape of that work as a clean prompt that could be run on a schedule (daily, weekly, etc.) and produce the same kind of output each time.

Output format:
NAME: <up to 60 chars, sentence case, no trailing punctuation>
PROMPT: <a clear, self-contained instruction in second person. Describe what should happen each time this runs. Do NOT reference the original conversation, "as discussed", specific dates, or anything that won't make sense to a future run. Two or three short paragraphs is usually right.>

Output ONLY the NAME and PROMPT lines. No preamble, no explanation, no markdown headings.`;

interface SummarizedScheduledTask {
  name: string;
  prompt: string;
}

function parseLlmOutput(text: string): SummarizedScheduledTask | null {
  const nameMatch = text.match(/^NAME:\s*(.+?)(?:\n|$)/m);
  const promptMatch = text.match(/PROMPT:\s*([\s\S]+)$/m);
  const name = nameMatch?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  const prompt = promptMatch?.[1]?.trim() ?? "";
  if (!name && !prompt) return null;
  return { name, prompt };
}

export interface UseSaveChatAsScheduledTaskResult {
  saveAsScheduledTask: () => Promise<void>;
  isSaving: boolean;
  canSave: boolean;
}

export function useSaveChatAsScheduledTask(
  taskId: string | undefined,
): UseSaveChatAsScheduledTaskResult {
  const session = useSessionForTask(taskId);
  const setPendingCreateDraft = useWorkStore((s) => s.setPendingCreateDraft);
  const navigateToWorkScheduledCreate = useNavigationStore(
    (s) => s.navigateToWorkScheduledCreate,
  );
  const [isSaving, setIsSaving] = useState(false);

  const hasContent = (session?.events?.length ?? 0) > 0;

  const saveAsScheduledTask = useCallback(async () => {
    if (!session || !hasContent || isSaving) return;
    setIsSaving(true);
    const toastId = toast.loading("Drafting scheduled task from this chat…");
    try {
      const transcript = flattenChatTranscript(session);
      if (!transcript.trim()) {
        toast.error("Nothing to summarize yet", { id: toastId });
        return;
      }

      const result = await trpcClient.llmGateway.prompt.mutate({
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user" as const,
            content: `Here is the conversation. Extract the scheduled-task NAME and PROMPT now.\n\n<conversation>\n${transcript}\n</conversation>`,
          },
        ],
      });

      const parsed = parseLlmOutput(result.content);
      if (!parsed || !parsed.prompt) {
        log.warn("LLM returned unparseable output", { raw: result.content });
        toast.error("Couldn't draft a scheduled task from this chat", {
          id: toastId,
        });
        return;
      }

      setPendingCreateDraft({
        name: parsed.name,
        prompt: parsed.prompt,
      });
      navigateToWorkScheduledCreate();
      toast.success("Drafted — review and pick a schedule", { id: toastId });
    } catch (error) {
      log.error("Failed to summarize chat for scheduled task", { error });
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't draft a scheduled task",
        { id: toastId },
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    session,
    hasContent,
    isSaving,
    setPendingCreateDraft,
    navigateToWorkScheduledCreate,
  ]);

  return { saveAsScheduledTask, isSaving, canSave: hasContent };
}
