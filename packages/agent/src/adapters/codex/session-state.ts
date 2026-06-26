import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { PermissionMode } from "../../execution-mode";
import type {
  McpToolApprovalsConfig,
  McpToolInstallationsConfig,
} from "../../server/schemas";
import type { ContextBreakdownBaseline } from "../claude/context-breakdown";

export interface CodexUsage {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
}

export interface CodexSessionState {
  sessionId: string;
  cwd: string;
  modelId?: string;
  modeId: string;
  configOptions: SessionConfigOption[];
  accumulatedUsage: CodexUsage;
  contextSize?: number;
  contextUsed?: number;
  contextBreakdownBaseline?: ContextBreakdownBaseline;
  permissionMode: PermissionMode;
  taskRunId?: string;
  taskId?: string;
  mcpToolApprovals?: McpToolApprovalsConfig;
  mcpToolInstallations?: McpToolInstallationsConfig;
}

export function createSessionState(
  sessionId: string,
  cwd: string,
  opts?: {
    taskRunId?: string;
    taskId?: string;
    modeId?: string;
    modelId?: string;
    permissionMode?: PermissionMode;
    mcpToolApprovals?: McpToolApprovalsConfig;
    mcpToolInstallations?: McpToolInstallationsConfig;
  },
): CodexSessionState {
  return {
    sessionId,
    cwd,
    modeId: opts?.modeId ?? "auto",
    modelId: opts?.modelId,
    configOptions: [],
    accumulatedUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
    },
    permissionMode: opts?.permissionMode ?? "auto",
    taskRunId: opts?.taskRunId,
    taskId: opts?.taskId,
    mcpToolApprovals: opts?.mcpToolApprovals,
    mcpToolInstallations: opts?.mcpToolInstallations,
  };
}

// codex-client closure-captures the original sessionState reference, so we
// must mutate in place across newSession/loadSession/resumeSession/forkSession
// — reassigning would orphan it and silently break usage propagation.
export function resetSessionState(
  state: CodexSessionState,
  sessionId: string,
  cwd: string,
  opts?: {
    taskRunId?: string;
    taskId?: string;
    modeId?: string;
    modelId?: string;
    permissionMode?: PermissionMode;
    mcpToolApprovals?: McpToolApprovalsConfig;
    mcpToolInstallations?: McpToolInstallationsConfig;
  },
): void {
  state.sessionId = sessionId;
  state.cwd = cwd;
  state.modeId = opts?.modeId ?? "auto";
  state.modelId = opts?.modelId;
  state.configOptions = [];
  state.accumulatedUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
  };
  state.contextSize = undefined;
  state.contextUsed = undefined;
  state.contextBreakdownBaseline = undefined;
  state.permissionMode = opts?.permissionMode ?? "auto";
  state.taskRunId = opts?.taskRunId;
  state.taskId = opts?.taskId;
  state.mcpToolApprovals = opts?.mcpToolApprovals;
  state.mcpToolInstallations = opts?.mcpToolInstallations;
}

export function resetUsage(state: CodexSessionState): void {
  state.accumulatedUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
  };
}
