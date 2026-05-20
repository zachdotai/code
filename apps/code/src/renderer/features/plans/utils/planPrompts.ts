function truncate(text: string, max = 120): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

/**
 * Prompt sent to the agent after a human appends a `[H]:` reply to a thread.
 * Includes a short snippet of the anchor block so the agent can locate the
 * right thread in the file. The agent is expected to append an `> [A]: …`
 * line directly under the new `[H]:` and avoid touching unrelated sections.
 */
export function buildAskAgentToReplyToPlanThreadPrompt(
  filePath: string,
  blockText: string,
): string {
  return [
    `I added a new \`[H]:\` reply to a thread in your plan at \`${filePath}\`.`,
    "",
    "The thread is anchored to a block starting with:",
    "",
    `> ${truncate(blockText)}`,
    "",
    "Please read the plan file, find that thread, and respond by appending",
    "an `> [A]: <your answer>` line directly under my message. Keep the rest",
    "of the plan unchanged.",
  ].join("\n");
}

/**
 * Prompt sent after the user resolves a thread. The agent integrates the
 * resolved feedback into the surrounding plan content and removes the
 * thread blockquote.
 */
export function buildAskAgentToIncorporateResolvedThreadPrompt(
  filePath: string,
): string {
  return [
    `I resolved one or more threads in your plan at \`${filePath}\`.`,
    "",
    "Please read the file, incorporate each resolved thread's feedback into",
    "the surrounding plan content, then delete those resolved thread",
    "blockquotes. Leave unresolved threads (those without a `> [resolved]`",
    "marker) untouched.",
  ].join("\n");
}
