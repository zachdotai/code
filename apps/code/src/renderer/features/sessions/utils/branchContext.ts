/** Builds a plain-text transcript of a task's conversation for summarisation. */
import { buildConversationItems } from "@features/sessions/components/buildConversationItems";
import type { AcpMessage } from "@shared/types/session-events";

/** Transcript budget handed to the summariser (~6k tokens). */
const MAX_TRANSCRIPT_CHARS = 24_000;
/** Per-message cap so one huge answer can't crowd out the rest. */
const MAX_BLOCK_CHARS = 2_000;

export interface BranchTranscript {
  transcript: string;
  turnCount: number;
  /** Whether older turns were dropped to fit the budget. */
  truncated: boolean;
}

function truncateBlock(text: string): string {
  if (text.length <= MAX_BLOCK_CHARS) return text;
  return `${text.slice(0, MAX_BLOCK_CHARS)}… (truncated)`;
}

/** Includes user messages and agent replies; tool calls become a one-liner. */
export function buildBranchTranscript(events: AcpMessage[]): BranchTranscript {
  const { items } = buildConversationItems(events, null);

  const blocks: string[] = [];
  let turnCount = 0;

  for (const item of items) {
    if (item.type === "user_message") {
      const content = item.content.trim();
      if (!content) continue;
      turnCount++;
      blocks.push(`## User\n${truncateBlock(content)}`);
      continue;
    }

    if (item.type === "session_update") {
      const update = item.update as {
        sessionUpdate?: string;
        content?: { type?: string; text?: string };
        title?: string;
      };
      if (
        update.sessionUpdate === "agent_message_chunk" &&
        update.content?.type === "text"
      ) {
        const text = update.content.text?.trim();
        if (text) blocks.push(`## Assistant\n${truncateBlock(text)}`);
      } else if (update.sessionUpdate === "tool_call") {
        blocks.push(`_(used tool: ${update.title ?? "unknown"})_`);
      }
    }
  }

  if (blocks.length === 0) {
    return { transcript: "", turnCount: 0, truncated: false };
  }

  // Keep the most recent blocks within the character budget.
  const kept: string[] = [];
  let total = 0;
  let truncated = false;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (total + block.length > MAX_TRANSCRIPT_CHARS && kept.length > 0) {
      truncated = true;
      break;
    }
    kept.push(block);
    total += block.length;
  }
  kept.reverse();

  const transcript = truncated
    ? `_(earlier turns omitted)_\n\n${kept.join("\n\n")}`
    : kept.join("\n\n");

  return { transcript, turnCount, truncated };
}
