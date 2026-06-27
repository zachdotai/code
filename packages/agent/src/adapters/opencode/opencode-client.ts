/**
 * ACP Client for the opencode subprocess.
 *
 * Acts as the "client" from opencode's perspective: it receives permission
 * requests, session updates, file I/O and terminal operations from opencode and
 * forwards them to the upstream PostHog Code client. Mostly transparent — the
 * only interception points are permission auto-approval (by mode) and
 * best-effort usage capture.
 */

import type {
  AgentSideConnection,
  Client,
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  TerminalHandle,
  TerminalOutputRequest,
  TerminalOutputResponse,
  ToolKind,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk";
import type { PermissionMode } from "../../execution-mode";
import type { Logger } from "../../utils/logger";
import type { OpencodeSessionState } from "./session-state";

const AUTO_APPROVED_KINDS: Record<PermissionMode, Set<ToolKind>> = {
  default: new Set(["read", "search", "fetch", "think"]),
  acceptEdits: new Set(["read", "edit", "search", "fetch", "think"]),
  plan: new Set(["read", "search", "fetch", "think"]),
  bypassPermissions: new Set([
    "read",
    "edit",
    "delete",
    "move",
    "search",
    "execute",
    "think",
    "fetch",
    "switch_mode",
    "other",
  ]),
  auto: new Set(["read", "search", "fetch", "think"]),
  "read-only": new Set(["read", "search", "fetch", "think"]),
  "full-access": new Set([
    "read",
    "edit",
    "delete",
    "move",
    "search",
    "execute",
    "think",
    "fetch",
    "switch_mode",
    "other",
  ]),
};

function shouldAutoApprove(
  mode: PermissionMode,
  kind: ToolKind | null | undefined,
): boolean {
  if (mode === "bypassPermissions" || mode === "full-access") return true;
  if (!kind) return false;
  return AUTO_APPROVED_KINDS[mode]?.has(kind) ?? false;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Best-effort token/context capture from a session update. opencode's exact
 * usage-update shape is still being pinned down (the spike couldn't complete a
 * billed turn), so every field is read defensively and a miss is a no-op rather
 * than a crash.
 */
function captureUsage(
  update: Record<string, unknown>,
  state: OpencodeSessionState,
): void {
  const used = asNumber(update.used) ?? asNumber(update.contextUsed);
  if (used !== undefined) state.contextUsed = used;

  const input = asNumber(update.inputTokens);
  const output = asNumber(update.outputTokens);
  const cachedRead = asNumber(update.cachedReadTokens);
  const cachedWrite = asNumber(update.cachedWriteTokens);
  if (input !== undefined) state.accumulatedUsage.inputTokens += input;
  if (output !== undefined) state.accumulatedUsage.outputTokens += output;
  if (cachedRead !== undefined) {
    state.accumulatedUsage.cachedReadTokens += cachedRead;
  }
  if (cachedWrite !== undefined) {
    state.accumulatedUsage.cachedWriteTokens += cachedWrite;
  }
}

export function createOpencodeClient(
  upstreamClient: AgentSideConnection,
  logger: Logger,
  sessionState: OpencodeSessionState,
): Client {
  const terminalHandles = new Map<string, TerminalHandle>();

  return {
    async requestPermission(
      params: RequestPermissionRequest,
    ): Promise<RequestPermissionResponse> {
      const kind = params.toolCall?.kind as ToolKind | null | undefined;
      if (shouldAutoApprove(sessionState.permissionMode, kind)) {
        const allowOption = params.options?.find(
          (o) => o.kind === "allow_once" || o.kind === "allow_always",
        );
        logger.debug("Auto-approving permission", {
          mode: sessionState.permissionMode,
          kind,
        });
        return {
          outcome: {
            outcome: "selected",
            optionId: allowOption?.optionId ?? "allow",
          },
        };
      }
      return upstreamClient.requestPermission(params);
    },

    async sessionUpdate(params: SessionNotification): Promise<void> {
      const update = params.update as Record<string, unknown> | undefined;
      if (update) captureUsage(update, sessionState);
      await upstreamClient.sessionUpdate(params);
    },

    async readTextFile(
      params: ReadTextFileRequest,
    ): Promise<ReadTextFileResponse> {
      return upstreamClient.readTextFile(params);
    },

    async writeTextFile(
      params: WriteTextFileRequest,
    ): Promise<WriteTextFileResponse> {
      return upstreamClient.writeTextFile(params);
    },

    async createTerminal(
      params: CreateTerminalRequest,
    ): Promise<CreateTerminalResponse> {
      const handle = await upstreamClient.createTerminal(params);
      terminalHandles.set(handle.id, handle);
      return { terminalId: handle.id };
    },

    async terminalOutput(
      params: TerminalOutputRequest,
    ): Promise<TerminalOutputResponse> {
      const handle = terminalHandles.get(params.terminalId);
      if (!handle) return { output: "", truncated: false };
      return handle.currentOutput();
    },

    async releaseTerminal(
      params: ReleaseTerminalRequest,
    ): Promise<ReleaseTerminalResponse | undefined> {
      const handle = terminalHandles.get(params.terminalId);
      if (handle) {
        terminalHandles.delete(params.terminalId);
        const result = await handle.release();
        return result ?? undefined;
      }
    },

    async waitForTerminalExit(
      params: WaitForTerminalExitRequest,
    ): Promise<WaitForTerminalExitResponse> {
      const handle = terminalHandles.get(params.terminalId);
      if (!handle) return { exitCode: 1 };
      return handle.waitForExit();
    },

    async killTerminal(
      params: KillTerminalRequest,
    ): Promise<KillTerminalResponse | undefined> {
      const handle = terminalHandles.get(params.terminalId);
      if (handle) return handle.kill();
    },

    async extMethod(
      method: string,
      params: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      return upstreamClient.extMethod(method, params);
    },

    async extNotification(
      method: string,
      params: Record<string, unknown>,
    ): Promise<void> {
      return upstreamClient.extNotification(method, params);
    },
  };
}
