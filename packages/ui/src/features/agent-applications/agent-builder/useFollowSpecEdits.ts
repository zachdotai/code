import { agentChatStore } from "@posthog/core/agent-chat/agentChatStore";
import type { AcpMessage } from "@posthog/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  AGENT_BUILDER_CHAT_ID,
  useAgentBuilderStore,
} from "./agentBuilderStore";

/**
 * Agent-builder posthog-MCP tools that mutate a revision (or the app metadata)
 * the configuration view renders — drawn from the write tools in the
 * agent-builder spec's `mcps[].tools` allowlist. Reads (`-retrieve`/`-list`),
 * `validate`, and session/skill tools are intentionally excluded. The runner
 * reports `<serverId>__<tool>` (e.g. `posthog__…`, or `mcp__posthog__…`), so we
 * compare against the segment after the last `__`.
 */
const REVISION_WRITE_TOOLS = new Set([
  "agent-applications-partial-update",
  "agent-applications-revisions-create",
  "agent-applications-revisions-new-draft-create",
  "agent-applications-revisions-clone-from-create",
  "agent-applications-revisions-partial-update",
  "agent-applications-revisions-agent-md-update",
  "agent-applications-revisions-skill-refs-set",
  "agent-applications-revisions-tools-update",
  "agent-applications-revisions-tools-destroy",
  "agent-applications-revisions-spec-update",
  "agent-applications-revisions-freeze-create",
  "agent-applications-revisions-promote-create",
  "agent-applications-revisions-archive-create",
]);

/** True when a tool-call title names a revision/app-mutating posthog MCP tool. */
function isRevisionWrite(title: string | undefined): boolean {
  if (!title) return false;
  return REVISION_WRITE_TOOLS.has(title.split("__").pop() ?? "");
}

/**
 * Revision-view query prefixes to refresh after a revision edit. Prefix-matched
 * by TanStack, so they cover every project/agent/revision without needing ids —
 * the same caches `useApplyAgentSpec` invalidates on a manual edit.
 */
const REVISION_PREFIXES = [
  ["agent-applications", "detail"],
  ["agent-applications", "revisions"],
  ["agent-applications", "revision"],
  ["agent-applications", "bundle"],
] as const;

interface ToolCallUpdate {
  sessionUpdate?: string;
  toolCallId?: string;
  title?: string;
  status?: string;
}

/** The `SessionUpdate` from a `session/update` ACP notification, else null. */
function toolUpdate(m: AcpMessage): ToolCallUpdate | null {
  const msg = m.message;
  if (!("method" in msg) || msg.method !== "session/update") return null;
  return (
    (msg as { params?: { update?: ToolCallUpdate } }).params?.update ?? null
  );
}

/**
 * Stateful scanner over a growing agent-builder transcript that counts
 * revision-writing MCP calls that have just *completed*. Correlates
 * start→completion by `toolCallId` (the completion update drops the tool name),
 * fires once per call, and treats whatever is present at the first scan as
 * backlog (resumed history) so a remount never replays past edits. A shrinking
 * transcript (newChat) resets the state.
 */
export function createRevisionEditDetector(): {
  scan: (messages: AcpMessage[]) => number;
} {
  const writeCalls = new Set<string>();
  const acted = new Set<string>();
  let processed = -1; // -1 until the first scan establishes the backlog baseline.

  return {
    scan(messages: AcpMessage[]): number {
      if (processed < 0) {
        processed = messages.length;
        return 0;
      }
      if (messages.length < processed) {
        writeCalls.clear();
        acted.clear();
        processed = 0;
      }
      let completed = 0;
      for (let i = processed; i < messages.length; i++) {
        const u = toolUpdate(messages[i]);
        if (!u?.toolCallId) continue;
        if (u.sessionUpdate === "tool_call" && isRevisionWrite(u.title)) {
          writeCalls.add(u.toolCallId);
        } else if (
          u.sessionUpdate === "tool_call_update" &&
          u.status === "completed" &&
          writeCalls.has(u.toolCallId) &&
          !acted.has(u.toolCallId)
        ) {
          acted.add(u.toolCallId);
          completed += 1;
        }
      }
      processed = messages.length;
      return completed;
    },
  };
}

/**
 * While the agent builder dock is open, watch its live stream for a completed
 * revision-writing MCP call (spec/agent-md/tools/skill edits, draft/clone,
 * freeze/promote/archive) and, when follow mode is on, invalidate the
 * revision-view queries so the currently-viewed revision refetches the edit the
 * builder just made. Revision queries are 30s-stale with no polling, so without
 * this the view shows the agent's change only after a manual refresh.
 *
 * Follow mode is read at fire time so toggling it never resubscribes — a call
 * that completes while paused is consumed by the detector, not retroactively
 * applied if follow mode is later turned on.
 */
export function useFollowSpecEdits(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const detector = createRevisionEditDetector();
    // Seed the backlog baseline from the current transcript (resumed history).
    detector.scan(
      agentChatStore.getState().chats[AGENT_BUILDER_CHAT_ID]?.messages ?? [],
    );

    return agentChatStore.subscribe((s) => {
      const messages = s.chats[AGENT_BUILDER_CHAT_ID]?.messages ?? [];
      if (detector.scan(messages) === 0) return;
      if (!useAgentBuilderStore.getState().followMode) return;
      for (const queryKey of REVISION_PREFIXES) {
        void queryClient.invalidateQueries({ queryKey });
      }
    });
  }, [queryClient]);
}
