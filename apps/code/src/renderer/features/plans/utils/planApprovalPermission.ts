import type { PermissionRequest } from "@features/sessions/utils/parseSessionLogs";

export interface PlanApproveOption {
  optionId: string;
  name: string;
  isBypass: boolean;
}

export interface PendingPlanPermission {
  toolCallId: string;
  approveOptions: PlanApproveOption[];
  /**
   * Safe default the UI should pre-select. `default` (manual approval) is
   * preferred when present, then any non-bypass `allow_*` option, and
   * `bypassPermissions` only when it is the sole approve option.
   */
  defaultOptionId: string;
  rejectOptionId: string | null;
}

const BYPASS_OPTION_ID = "bypassPermissions";
const PREFERRED_DEFAULT_OPTION_ID = "default";

function pickDefault(approve: PlanApproveOption[]): string {
  if (approve.length === 0) {
    throw new Error("pickDefault called with no approve options");
  }
  const preferred = approve.find(
    (o) => o.optionId === PREFERRED_DEFAULT_OPTION_ID,
  );
  if (preferred) return preferred.optionId;
  const nonBypass = approve.find((o) => !o.isBypass);
  return (nonBypass ?? approve[0]).optionId;
}

/**
 * Pulls the pending `ExitPlanMode` switch_mode permission out of the
 * task's permission map and exposes every allow_* option so the UI can
 * render a picker. Refuses to silently auto-pick whichever option the
 * agent happens to put first — the previous behavior caused `Approve plan`
 * to slip the session into `bypassPermissions` mode on fresh tasks
 * (where there is no `previousMode` to promote a safer option).
 */
export function findPendingPlanPermission(
  permissions: Map<string, PermissionRequest>,
): PendingPlanPermission | null {
  for (const req of permissions.values()) {
    const toolCallId = req.toolCall?.toolCallId;
    if (!toolCallId) continue;
    if (req.toolCall?.kind !== "switch_mode") continue;

    const approveOptions: PlanApproveOption[] = req.options
      .filter((o) => o.kind === "allow_once" || o.kind === "allow_always")
      .map((o) => ({
        optionId: o.optionId,
        name: o.name,
        isBypass: o.optionId === BYPASS_OPTION_ID,
      }));
    if (approveOptions.length === 0) continue;

    const reject = req.options.find(
      (o) => o.kind === "reject_once" || o.kind === "reject_always",
    );

    return {
      toolCallId,
      approveOptions,
      defaultOptionId: pickDefault(approveOptions),
      rejectOptionId: reject?.optionId ?? null,
    };
  }
  return null;
}
