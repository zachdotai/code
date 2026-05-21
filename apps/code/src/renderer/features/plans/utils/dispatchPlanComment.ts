import type { PermissionRequest } from "@features/sessions/utils/parseSessionLogs";

interface PlanCommentSessionService {
  respondToPermission(
    taskId: string,
    toolCallId: string,
    optionId: string,
    customInput?: string,
  ): Promise<void>;
  sendPrompt(taskId: string, prompt: string): Promise<{ stopReason: string }>;
}

export type DispatchPlanCommentResult =
  | { via: "sent_prompt" }
  | { via: "rejected_permission"; toolCallId: string };

interface DispatchPlanCommentArgs {
  taskId: string;
  pendingPermissions: Map<string, PermissionRequest>;
  prompt: string;
  sessionService: PlanCommentSessionService;
}

function findPendingPlanRejection(
  permissions: Map<string, PermissionRequest>,
): { toolCallId: string; rejectOptionId: string } | null {
  for (const req of permissions.values()) {
    if (req.toolCall?.kind !== "switch_mode") continue;
    const toolCallId = req.toolCall.toolCallId;
    if (!toolCallId) continue;
    const reject = req.options.find(
      (o) => o.kind === "reject_once" || o.kind === "reject_always",
    );
    if (!reject) continue;
    return { toolCallId, rejectOptionId: reject.optionId };
  }
  return null;
}

/**
 * Dispatches a plan-comment follow-up prompt to the agent.
 *
 * When the agent finishes generating a plan it issues an `ExitPlanMode`
 * (kind `switch_mode`) permission request. While that permission is
 * pending the session's `isPromptPending` flag is true, so a normal
 * `sendPrompt` would silently queue and the agent would never react to
 * the user's comment. To keep the comment loop responsive we resolve
 * the pending permission with `reject_with_feedback`, passing the prompt
 * as the feedback text — the agent processes the rejection feedback,
 * stays in plan mode, and reacts to the new `[H]:` thread in the file.
 *
 * If no `switch_mode` permission is pending (e.g. the comment loop has
 * been running for a while and the agent is idle, or only an unrelated
 * permission is pending), we send the prompt normally.
 */
export async function dispatchPlanComment(
  args: DispatchPlanCommentArgs,
): Promise<DispatchPlanCommentResult> {
  const rejection = findPendingPlanRejection(args.pendingPermissions);
  if (rejection) {
    await args.sessionService.respondToPermission(
      args.taskId,
      rejection.toolCallId,
      rejection.rejectOptionId,
      args.prompt,
    );
    return { via: "rejected_permission", toolCallId: rejection.toolCallId };
  }
  await args.sessionService.sendPrompt(args.taskId, args.prompt);
  return { via: "sent_prompt" };
}
