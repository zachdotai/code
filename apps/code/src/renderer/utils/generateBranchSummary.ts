/** Summarises an in-progress task so a branched task can pick up from it. */
import { fetchAuthState } from "@features/auth/hooks/authQueries";
import { trpcClient } from "@renderer/trpc";
import { logger } from "@utils/logger";

const log = logger.scope("branch-summary");

/** Stronger than the title-generator default — handoff fidelity matters. */
const BRANCH_SUMMARY_MODEL = "claude-sonnet-4-6";
const BRANCH_SUMMARY_MAX_TOKENS = 1500;

const SYSTEM_PROMPT = `You are summarising an in-progress task so it can be continued as a new, fresh task ("branching"). The new task starts with no conversation history — your summary is the ONLY context it will have.

Output using exactly this format:

TITLE: <title>
CONTEXT:
<briefing>

Title rules:
- Short (max 6 words), sentence case, action-verb first where natural.
- Reflects what the branched task should continue doing.
- Never wrap in quotes.

Briefing rules:
- Write a clear, self-contained handoff briefing in the second person ("You are continuing...").
- Cover, in order: the overall goal; key decisions and constraints established so far; what has already been done; what remains to be done; and any relevant files, commands, or gotchas.
- Use short paragraphs or bullet points. Be specific — include file names, function names, and concrete details mentioned in the conversation.
- Do NOT invent facts. Only summarise what the transcript supports.
- Do NOT address or answer the task yourself — only summarise.

Never include any text outside the TITLE and CONTEXT sections.`;

export interface BranchSummary {
  title: string;
  context: string;
}

/** Returns `null` on failure so callers can fall back to the raw transcript. */
export async function generateBranchSummary(
  transcript: string,
  originalDescription: string,
): Promise<BranchSummary | null> {
  try {
    const authState = await fetchAuthState();
    if (authState.status !== "authenticated") return null;

    const result = await trpcClient.llmGateway.prompt.mutate({
      system: SYSTEM_PROMPT,
      model: BRANCH_SUMMARY_MODEL,
      maxTokens: BRANCH_SUMMARY_MAX_TOKENS,
      messages: [
        {
          role: "user" as const,
          content: `Summarise the following task so it can be continued as a fresh task. Original task description:\n\n<description>\n${originalDescription}\n</description>\n\nConversation so far:\n\n<transcript>\n${transcript}\n</transcript>\n\nOutput the TITLE and CONTEXT now:`,
        },
      ],
    });

    const text = result.content.trim();
    const titleMatch = text.match(/^TITLE:\s*(.+?)(?:\n|$)/m);
    const contextMatch = text.match(/CONTEXT:\s*([\s\S]+)$/m);

    const title =
      titleMatch?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, "")
        .slice(0, 255) ?? "";
    const context = contextMatch?.[1]?.trim() ?? "";

    if (!context) return null;

    return { title: title || "Branched task", context };
  } catch (error) {
    log.error("Failed to generate branch summary", { error });
    return null;
  }
}
