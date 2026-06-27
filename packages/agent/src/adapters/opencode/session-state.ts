import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { PermissionMode } from "../../execution-mode";

export interface OpencodeUsage {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
}

export interface OpencodeSessionState {
  sessionId: string;
  cwd: string;
  modelId?: string;
  configOptions: SessionConfigOption[];
  accumulatedUsage: OpencodeUsage;
  contextUsed?: number;
  permissionMode: PermissionMode;
  taskRunId?: string;
  taskId?: string;
}

function emptyUsage(): OpencodeUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
  };
}

export function createSessionState(
  sessionId: string,
  cwd: string,
): OpencodeSessionState {
  return {
    sessionId,
    cwd,
    configOptions: [],
    accumulatedUsage: emptyUsage(),
    permissionMode: "auto",
  };
}

// opencode-client closure-captures the original sessionState reference, so we
// mutate in place across newSession — reassigning would orphan it and break
// usage propagation. (Mirrors the codex adapter's single-owner discipline.)
export function resetSessionState(
  state: OpencodeSessionState,
  sessionId: string,
  cwd: string,
  opts?: {
    taskRunId?: string;
    taskId?: string;
    modelId?: string;
    permissionMode?: PermissionMode;
  },
): void {
  state.sessionId = sessionId;
  state.cwd = cwd;
  state.modelId = opts?.modelId;
  state.configOptions = [];
  state.accumulatedUsage = emptyUsage();
  state.contextUsed = undefined;
  state.permissionMode = opts?.permissionMode ?? "auto";
  state.taskRunId = opts?.taskRunId;
  state.taskId = opts?.taskId;
}

export function resetUsage(state: OpencodeSessionState): void {
  state.accumulatedUsage = emptyUsage();
}
