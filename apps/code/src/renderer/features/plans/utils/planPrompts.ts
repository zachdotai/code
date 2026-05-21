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

/**
 * Prompt sent when the user clicks Approve in the Plan view's approval bar
 * AND no ExitPlanMode permission is currently pending (i.e. the agent is
 * idle in plan mode after a comment loop). Kicks the agent off to start
 * implementing in the new mode.
 */
export function buildPlanImplementationPrompt(): string {
  return [
    "I approved the plan. Please proceed with implementing it now.",
    "If anything is unclear, ask before making major changes.",
  ].join("\n");
}

/**
 * Prompt sent when the user clicks Reject in the Plan view's approval bar
 * AND no ExitPlanMode permission is currently pending (i.e. the agent is
 * mid-iteration on the plan). The agent stays in plan mode and revises.
 */
export function buildPlanRejectionPrompt(feedback: string): string {
  const lines = [
    "I'm rejecting the current plan. Please revise it (stay in plan mode).",
  ];
  if (feedback) {
    lines.push("", "Feedback:", feedback);
  }
  return lines.join("\n");
}
