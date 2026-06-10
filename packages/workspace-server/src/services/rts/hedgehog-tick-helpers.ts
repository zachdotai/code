import type { TickContext } from "./hedgehog-handlers/types";
import { HOGLET_OUTPUT_KINDS, type HogletWithState } from "./hedgehog-prompts";
import type { NestMessage } from "./schemas";

/**
 * Pure helpers shared between `HedgehogTickService` and
 * `HedgehogDecisionRouter`. Kept side-effect free so both files can stay tight
 * without pulling helpers across services.
 */

export function parseTimestamp(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function isHogletOutputMessage(message: NestMessage): boolean {
  return message.sourceTaskId !== null && HOGLET_OUTPUT_KINDS.has(message.kind);
}

export function latestMessageAt(
  messages: NestMessage[],
  predicate: (message: NestMessage) => boolean,
): string | null {
  let latest: string | null = null;
  let latestMs: number | null = null;
  for (const message of messages) {
    if (!predicate(message)) continue;
    const createdMs = parseTimestamp(message.createdAt);
    if (createdMs === null) continue;
    if (latestMs === null || createdMs > latestMs) {
      latest = new Date(createdMs).toISOString();
      latestMs = createdMs;
    }
  }
  return latest;
}

export function latestOperatorMessageAt(
  recentChat: NestMessage[],
): string | null {
  return latestMessageAt(
    recentChat,
    (message) => message.kind === "user_message",
  );
}

export function latestHogletOutputAt(recentChat: NestMessage[]): string | null {
  return latestMessageAt(recentChat, isHogletOutputMessage);
}

export function prStatusFingerprint(
  hoglets: HogletWithState[],
  prDependencies: TickContext["prDependencies"],
): string {
  return JSON.stringify({
    hoglets: hoglets
      .map((entry) => ({
        taskId: entry.hoglet.taskId,
        latestRunId: entry.latestRunId,
        taskRunStatus: entry.taskRunStatus,
        latestRunCompletedAt: entry.latestRunCompletedAt,
        prUrl: entry.prUrl,
        prState: entry.prState,
        branch: entry.branch,
      }))
      .sort((a, b) => a.taskId.localeCompare(b.taskId)),
    prDependencies: prDependencies
      .map((edge) => ({
        id: edge.id,
        parentTaskId: edge.parentTaskId,
        childTaskId: edge.childTaskId,
        state: edge.state,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}
