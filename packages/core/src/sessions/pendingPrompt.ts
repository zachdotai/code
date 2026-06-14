import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { Adapter, ExecutionMode } from "@posthog/shared";

/**
 * A durable, write-ahead record of a prompt the user is trying to start a
 * local task run with.
 *
 * The prompt is the one thing in the start-a-task flow that the user cannot
 * cheaply reproduce, yet today it only exists in memory until a session has
 * fully initialized and `session/prompt` has been delivered. If session
 * initialization throws or times out (common in large monorepos, where init
 * can exceed the 30s `SESSION_VALIDATION_TIMEOUT_MS` budget), or the app is
 * reloaded/quit/crashes during the retry window, the prompt is lost.
 *
 * To make that impossible we persist this record BEFORE any agent/session
 * setup is attempted, and only clear it once the prompt has actually been
 * delivered to the agent. A persisted record therefore means "this prompt is
 * owed delivery and has not been delivered yet" — the basis for recovering it
 * on the next connect, and (in a later change) for a server-side reconciler to
 * re-drive orphaned runs.
 */
export interface PendingPromptRecord {
  taskId: string;
  taskTitle: string;
  repoPath: string;
  initialPrompt: ContentBlock[];
  /** Latest run id this prompt was attached to, if a run has been created. */
  taskRunId?: string;
  executionMode?: ExecutionMode;
  adapter?: Adapter;
  model?: string;
  reasoningLevel?: string;
  /** Epoch ms when the prompt was first written ahead. */
  createdAt: number;
}

/**
 * Durable storage for {@link PendingPromptRecord}s, keyed by `taskId` (one
 * in-flight prompt per task — retries reuse the same key). Implementations
 * must survive an app restart.
 */
export interface PendingPromptStore {
  /** Write-ahead (or overwrite) the pending prompt for a task. */
  save(record: PendingPromptRecord): void;
  /** Get the pending prompt for a task, if one is owed delivery. */
  get(taskId: string): PendingPromptRecord | undefined;
  /** Clear the pending prompt for a task once delivered or abandoned. */
  remove(taskId: string): void;
  /** All outstanding pending prompts, e.g. for a recovery sweep on startup. */
  list(): PendingPromptRecord[];
}
