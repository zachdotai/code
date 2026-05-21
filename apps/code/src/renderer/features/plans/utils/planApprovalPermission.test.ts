import type { PermissionRequest } from "@features/sessions/utils/parseSessionLogs";
import { describe, expect, it } from "vitest";
import { findPendingPlanPermission } from "./planApprovalPermission";

type AllowKind = "allow_once" | "allow_always";
type RejectKind = "reject_once" | "reject_always";

function makePermission(
  options: { optionId: string; name: string; kind: AllowKind | RejectKind }[],
  toolCallId = "tc-1",
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

describe("findPendingPlanPermission", () => {
  it("returns null when there are no permissions", () => {
    expect(findPendingPlanPermission(new Map())).toBeNull();
  });

  it("ignores permissions whose toolCall is not switch_mode", () => {
    const map = makeMap([
      {
        ...makePermission([{ optionId: "x", name: "x", kind: "allow_once" }]),
        toolCall: {
          toolCallId: "tc-1",
          title: "Edit",
          kind: "edit",
          content: [],
          locations: [],
          rawInput: {},
        },
      } as unknown as PermissionRequest,
    ]);
    expect(findPendingPlanPermission(map)).toBeNull();
  });

  it("returns ALL allow_* options as approve choices (not just the first)", () => {
    const map = makeMap([
      makePermission([
        {
          optionId: "bypassPermissions",
          name: "Yes, bypass all permissions",
          kind: "allow_always",
        },
        { optionId: "auto", name: 'Yes, "auto"', kind: "allow_always" },
        { optionId: "acceptEdits", name: "Yes, accept", kind: "allow_always" },
        { optionId: "default", name: "Yes, manual", kind: "allow_once" },
        { optionId: "reject", name: "No", kind: "reject_once" },
      ]),
    ]);
    const found = findPendingPlanPermission(map);
    expect(found).not.toBeNull();
    expect(found?.approveOptions.map((o) => o.optionId)).toEqual([
      "bypassPermissions",
      "auto",
      "acceptEdits",
      "default",
    ]);
  });

  it("preserves option names so the UI can label the picker accurately", () => {
    const map = makeMap([
      makePermission([
        { optionId: "auto", name: 'Yes, "auto" mode', kind: "allow_always" },
        {
          optionId: "default",
          name: "Yes, manually approve",
          kind: "allow_once",
        },
      ]),
    ]);
    const found = findPendingPlanPermission(map);
    expect(found?.approveOptions.find((o) => o.optionId === "auto")?.name).toBe(
      'Yes, "auto" mode',
    );
  });

  it("flags bypassPermissions explicitly so the UI can warn before applying it", () => {
    const map = makeMap([
      makePermission([
        {
          optionId: "bypassPermissions",
          name: "Yes, bypass all permissions",
          kind: "allow_always",
        },
        { optionId: "default", name: "Yes, manual", kind: "allow_once" },
      ]),
    ]);
    const found = findPendingPlanPermission(map);
    expect(
      found?.approveOptions.find((o) => o.optionId === "bypassPermissions")
        ?.isBypass,
    ).toBe(true);
    expect(
      found?.approveOptions.find((o) => o.optionId === "default")?.isBypass,
    ).toBe(false);
  });

  it("computes a safe default that is NOT bypassPermissions when other allow_* options exist", () => {
    const map = makeMap([
      makePermission([
        {
          optionId: "bypassPermissions",
          name: "Yes, bypass all permissions",
          kind: "allow_always",
        },
        { optionId: "auto", name: 'Yes, "auto"', kind: "allow_always" },
        { optionId: "default", name: "Yes, manual", kind: "allow_once" },
      ]),
    ]);
    const found = findPendingPlanPermission(map);
    expect(found?.defaultOptionId).not.toBe("bypassPermissions");
    // Prefer the safest non-bypass option — `default` (manual approval).
    expect(found?.defaultOptionId).toBe("default");
  });

  it("falls back to the first non-bypass option when `default` is absent", () => {
    const map = makeMap([
      makePermission([
        {
          optionId: "bypassPermissions",
          name: "Yes, bypass",
          kind: "allow_always",
        },
        { optionId: "auto", name: 'Yes, "auto"', kind: "allow_always" },
        { optionId: "acceptEdits", name: "Yes, accept", kind: "allow_always" },
      ]),
    ]);
    const found = findPendingPlanPermission(map);
    expect(found?.defaultOptionId).toBe("auto");
  });

  it("returns bypassPermissions as default ONLY when it is the sole approve option", () => {
    const map = makeMap([
      makePermission([
        {
          optionId: "bypassPermissions",
          name: "Yes, bypass",
          kind: "allow_always",
        },
      ]),
    ]);
    const found = findPendingPlanPermission(map);
    expect(found?.defaultOptionId).toBe("bypassPermissions");
  });

  it("returns the first reject_* option's id for rejection (null if none)", () => {
    const withReject = makeMap([
      makePermission([
        { optionId: "default", name: "Yes", kind: "allow_once" },
        { optionId: "reject_once", name: "No", kind: "reject_once" },
        {
          optionId: "reject_with_feedback",
          name: "Feedback",
          kind: "reject_once",
        },
      ]),
    ]);
    expect(findPendingPlanPermission(withReject)?.rejectOptionId).toBe(
      "reject_once",
    );

    const noReject = makeMap([
      makePermission([
        { optionId: "default", name: "Yes", kind: "allow_once" },
      ]),
    ]);
    expect(findPendingPlanPermission(noReject)?.rejectOptionId).toBeNull();
  });
});
