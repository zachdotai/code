import type { PermissionRequest } from "@features/sessions/utils/parseSessionLogs";
import { describe, expect, it, vi } from "vitest";
import { dispatchPlanComment } from "./dispatchPlanComment";

type AllowKind = "allow_once" | "allow_always";
type RejectKind = "reject_once" | "reject_always";

function makePermission(
  options: { optionId: string; name: string; kind: AllowKind | RejectKind }[],
  toolCallId = "tc-plan",
): PermissionRequest {
  return {
    taskRunId: "task-1",
    receivedAt: 0,
    options,
    toolCall: {
      toolCallId,
      title: "Switch mode",
      kind: "switch_mode",
      content: [],
      locations: [],
      rawInput: {},
    },
  } as unknown as PermissionRequest;
}

function makeMap(reqs: PermissionRequest[]): Map<string, PermissionRequest> {
  return new Map(
    reqs.map((r) => [r.toolCall?.toolCallId ?? Math.random().toString(), r]),
  );
}

describe("dispatchPlanComment", () => {
  it("sends the prompt directly when no plan permission is pending", async () => {
    const respondToPermission = vi.fn().mockResolvedValue(undefined);
    const sendPrompt = vi.fn().mockResolvedValue({ stopReason: "ok" });

    const result = await dispatchPlanComment({
      taskId: "task-1",
      pendingPermissions: new Map(),
      prompt: "Please reply to my comment",
      sessionService: { respondToPermission, sendPrompt },
    });

    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(sendPrompt).toHaveBeenCalledWith(
      "task-1",
      "Please reply to my comment",
    );
    expect(respondToPermission).not.toHaveBeenCalled();
    expect(result).toEqual({ via: "sent_prompt" });
  });

  it("rejects the pending ExitPlanMode permission with the prompt as feedback instead of sending a queued prompt", async () => {
    const respondToPermission = vi.fn().mockResolvedValue(undefined);
    const sendPrompt = vi.fn().mockResolvedValue({ stopReason: "ok" });
    const perm = makePermission([
      { optionId: "default", name: "Default", kind: "allow_once" },
      {
        optionId: "reject_with_feedback",
        name: "Reject",
        kind: "reject_once",
      },
    ]);

    const result = await dispatchPlanComment({
      taskId: "task-2",
      pendingPermissions: makeMap([perm]),
      prompt: "Please reply to my comment",
      sessionService: { respondToPermission, sendPrompt },
    });

    expect(respondToPermission).toHaveBeenCalledTimes(1);
    expect(respondToPermission).toHaveBeenCalledWith(
      "task-2",
      "tc-plan",
      "reject_with_feedback",
      "Please reply to my comment",
    );
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(result).toEqual({
      via: "rejected_permission",
      toolCallId: "tc-plan",
    });
  });

  it("uses reject_always when only reject_always is offered", async () => {
    const respondToPermission = vi.fn().mockResolvedValue(undefined);
    const sendPrompt = vi.fn().mockResolvedValue({ stopReason: "ok" });
    const perm = makePermission([
      { optionId: "default", name: "Default", kind: "allow_once" },
      {
        optionId: "reject_always",
        name: "Reject always",
        kind: "reject_always",
      },
    ]);

    await dispatchPlanComment({
      taskId: "task-3",
      pendingPermissions: makeMap([perm]),
      prompt: "Feedback",
      sessionService: { respondToPermission, sendPrompt },
    });

    expect(respondToPermission).toHaveBeenCalledWith(
      "task-3",
      "tc-plan",
      "reject_always",
      "Feedback",
    );
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it("falls back to sendPrompt when the pending switch_mode permission has no reject option", async () => {
    const respondToPermission = vi.fn().mockResolvedValue(undefined);
    const sendPrompt = vi.fn().mockResolvedValue({ stopReason: "ok" });
    const perm = makePermission([
      { optionId: "default", name: "Default", kind: "allow_once" },
    ]);

    await dispatchPlanComment({
      taskId: "task-4",
      pendingPermissions: makeMap([perm]),
      prompt: "Feedback",
      sessionService: { respondToPermission, sendPrompt },
    });

    expect(respondToPermission).not.toHaveBeenCalled();
    expect(sendPrompt).toHaveBeenCalledWith("task-4", "Feedback");
  });

  it("ignores non-switch_mode pending permissions and sends the prompt", async () => {
    const respondToPermission = vi.fn().mockResolvedValue(undefined);
    const sendPrompt = vi.fn().mockResolvedValue({ stopReason: "ok" });
    const otherPerm = {
      taskRunId: "task-1",
      receivedAt: 0,
      options: [
        { optionId: "default", name: "Allow", kind: "allow_once" },
        {
          optionId: "reject_with_feedback",
          name: "Reject",
          kind: "reject_once",
        },
      ],
      toolCall: {
        toolCallId: "tc-edit",
        title: "Edit",
        kind: "edit",
        content: [],
        locations: [],
        rawInput: {},
      },
    } as unknown as PermissionRequest;

    await dispatchPlanComment({
      taskId: "task-5",
      pendingPermissions: makeMap([otherPerm]),
      prompt: "Feedback",
      sessionService: { respondToPermission, sendPrompt },
    });

    expect(respondToPermission).not.toHaveBeenCalled();
    expect(sendPrompt).toHaveBeenCalledWith("task-5", "Feedback");
  });
});
