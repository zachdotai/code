import type { AcpMessage } from "@shared/types/session-events";
import { isJsonRpcNotification } from "@shared/types/session-events";

/**
 * Matches paths under the Claude plans directory:
 *   `~/.claude/plans/<file>.md` (or `$CLAUDE_CONFIG_DIR/plans/<file>.md`).
 * We don't need to resolve the home directory in the renderer — recognising
 * the `/.claude/plans/<basename>.md` suffix is enough to identify plan files.
 */
const PLAN_PATH_RE = /[/\\]\.claude[/\\]plans[/\\][^/\\]+\.md$/;

/**
 * Walks the session's events back-to-front and returns the most recent plan
 * file path the agent has written or edited. Returns `null` if the agent
 * has not touched a plan file in this session.
 */
export function extractLatestPlanFilePath(events: AcpMessage[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const msg = events[i]?.message;
    if (!msg || !isJsonRpcNotification(msg)) continue;
    if (msg.method !== "session/update") continue;

    const update = (msg.params as { update?: unknown } | undefined)?.update as
      | {
          sessionUpdate?: string;
          rawInput?: { file_path?: string };
          _meta?: { claudeCode?: { toolName?: string } };
        }
      | undefined;
    if (!update) continue;
    if (
      update.sessionUpdate !== "tool_call" &&
      update.sessionUpdate !== "tool_call_update"
    ) {
      continue;
    }
    const toolName = update._meta?.claudeCode?.toolName;
    if (
      toolName !== "Write" &&
      toolName !== "Edit" &&
      toolName !== "MultiEdit"
    ) {
      continue;
    }
    const filePath = update.rawInput?.file_path;
    if (typeof filePath === "string" && PLAN_PATH_RE.test(filePath)) {
      return filePath;
    }
  }
  return null;
}

export function isPlanFilePath(filePath: string): boolean {
  return PLAN_PATH_RE.test(filePath);
}
