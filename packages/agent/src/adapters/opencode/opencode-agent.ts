/**
 * In-process ACP proxy agent for opencode.
 *
 * Implements the ACP Agent interface and delegates to the `opencode acp`
 * subprocess over a ClientSideConnection. opencode already speaks ACP, so most
 * methods are near-transparent forwards; the interception points are
 * PostHog-specific notifications (sdk_session, turn_complete), model-picker
 * normalization, and permission-mode tracking.
 *
 * v1 deliberately defers (vs. the codex adapter): session resume/fork/refresh,
 * structured-output and local-tools MCP injection, broadcastUserMessage, PR
 * context, and context-breakdown telemetry.
 */

import {
  type AgentSideConnection,
  ClientSideConnection,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  ndJsonStream,
  type PromptRequest,
  type PromptResponse,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
} from "@agentclientprotocol/sdk";
import packageJson from "../../../package.json" with { type: "json" };
import { POSTHOG_NOTIFICATIONS } from "../../acp-extensions";
import { isCodeExecutionMode, type PermissionMode } from "../../execution-mode";
import type { ProcessSpawnedCallback } from "../../types";
import { Logger } from "../../utils/logger";
import {
  nodeReadableToWebReadable,
  nodeWritableToWebWritable,
} from "../../utils/streams";
import { BaseAcpAgent, type BaseSession } from "../base-acp-agent";
import { resolveTaskId } from "../session-meta";
import {
  modelIdFromConfigOptions,
  normalizeOpencodeConfigOptions,
} from "./models";
import { createOpencodeClient } from "./opencode-client";
import {
  createSessionState,
  type OpencodeSessionState,
  resetSessionState,
  resetUsage,
} from "./session-state";
import { OpencodeSettingsManager } from "./settings";
import {
  type OpencodeProcess,
  type OpencodeProcessOptions,
  spawnOpencodeProcess,
} from "./spawn";

interface OpencodeNewSessionMeta {
  taskRunId?: string;
  taskId?: string;
  permissionMode?: string;
  persistence?: { taskId?: string; runId?: string };
}

function toPermissionMode(mode?: string): PermissionMode {
  if (mode && isCodeExecutionMode(mode)) return mode;
  return "auto";
}

type OpencodeSession = BaseSession & {
  settingsManager: OpencodeSettingsManager;
  promptRunning: boolean;
};

export interface OpencodeAcpAgentOptions {
  opencodeProcessOptions: OpencodeProcessOptions;
  processCallbacks?: ProcessSpawnedCallback;
  logger?: Logger;
}

export class OpencodeAcpAgent extends BaseAcpAgent {
  readonly adapterName = "opencode";
  declare session: OpencodeSession;
  private opencodeProcess: OpencodeProcess;
  private connection: ClientSideConnection;
  private sessionState: OpencodeSessionState;
  // Serialize prompt() so the per-turn usage accumulator stays single-owner.
  private promptMutex: Promise<unknown> = Promise.resolve();

  constructor(client: AgentSideConnection, options: OpencodeAcpAgentOptions) {
    super(client);
    this.logger =
      options.logger ??
      new Logger({ debug: true, prefix: "[OpencodeAcpAgent]" });

    const cwd = options.opencodeProcessOptions.cwd ?? process.cwd();
    const settingsManager = new OpencodeSettingsManager(cwd);

    this.opencodeProcess = spawnOpencodeProcess({
      ...options.opencodeProcessOptions,
      logger: this.logger,
      processCallbacks: options.processCallbacks,
    });

    const readable = nodeReadableToWebReadable(this.opencodeProcess.stdout);
    const writable = nodeWritableToWebWritable(this.opencodeProcess.stdin);
    const stream = ndJsonStream(writable, readable);

    this.session = {
      abortController: new AbortController(),
      settingsManager,
      notificationHistory: [],
      cancelled: false,
      promptRunning: false,
    };

    this.sessionState = createSessionState("", cwd);

    this.connection = new ClientSideConnection(
      () => createOpencodeClient(this.client, this.logger, this.sessionState),
      stream,
    );
  }

  async initialize(request: InitializeRequest): Promise<InitializeResponse> {
    await this.session.settingsManager.initialize();
    const response = await this.connection.initialize(request);

    // v1 doesn't implement loadSession/resumeSession/fork, so don't advertise
    // them upward — PostHog Code would otherwise attempt resume and fail.
    const {
      resume: _resume,
      fork: _fork,
      ...sessionCapabilities
    } = response.agentCapabilities?.sessionCapabilities ?? {};

    return {
      ...response,
      agentCapabilities: {
        ...response.agentCapabilities,
        sessionCapabilities,
      },
      agentInfo: {
        name: packageJson.name,
        title: "OpenCode Agent",
        version: packageJson.version,
      },
      _meta: {
        ...(response as { _meta?: Record<string, unknown> })._meta,
        posthog: { steering: "interrupt-resend" },
      },
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const meta = params._meta as OpencodeNewSessionMeta | undefined;
    const permissionMode = toPermissionMode(meta?.permissionMode);

    const response = await this.connection.newSession(params);
    response.configOptions = normalizeOpencodeConfigOptions(
      response.configOptions,
    );

    resetSessionState(this.sessionState, response.sessionId, params.cwd, {
      taskRunId: meta?.taskRunId,
      taskId: resolveTaskId(meta),
      modelId: modelIdFromConfigOptions(response.configOptions),
      permissionMode,
    });
    this.sessionId = response.sessionId;
    this.sessionState.configOptions = response.configOptions ?? [];

    if (meta?.taskRunId) {
      await this.client.extNotification(POSTHOG_NOTIFICATIONS.SDK_SESSION, {
        taskRunId: meta.taskRunId,
        sessionId: response.sessionId,
        adapter: "opencode",
      });
    }

    this.logger.info("opencode session created", {
      sessionId: response.sessionId,
      taskRunId: meta?.taskRunId,
    });
    return response;
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const previous = this.promptMutex;
    const next = previous.catch(() => {}).then(() => this.runPrompt(params));
    this.promptMutex = next;
    return next;
  }

  private async runPrompt(params: PromptRequest): Promise<PromptResponse> {
    this.session.cancelled = false;
    this.session.interruptReason = undefined;
    resetUsage(this.sessionState);

    this.session.promptRunning = true;
    let response: PromptResponse;
    try {
      response = await this.connection.prompt(params);
    } finally {
      this.session.promptRunning = false;
    }

    if (this.sessionState.taskRunId) {
      const usage = this.sessionState.accumulatedUsage;
      await this.client.extNotification(POSTHOG_NOTIFICATIONS.TURN_COMPLETE, {
        sessionId: params.sessionId,
        stopReason: response.stopReason ?? "end_turn",
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedReadTokens: usage.cachedReadTokens,
          cachedWriteTokens: usage.cachedWriteTokens,
          totalTokens:
            usage.inputTokens +
            usage.outputTokens +
            usage.cachedReadTokens +
            usage.cachedWriteTokens,
        },
      });
    }

    return response;
  }

  protected async interrupt(): Promise<void> {
    await this.connection.cancel({ sessionId: this.sessionId });
  }

  async setSessionMode(
    params: SetSessionModeRequest,
  ): Promise<SetSessionModeResponse> {
    // Permissions are enforced client-side via the auto-approve table, so we
    // only track the requested mode locally for v1.
    this.sessionState.permissionMode = toPermissionMode(params.modeId);
    return {};
  }

  async setSessionConfigOption(
    params: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    const response = await this.connection.setSessionConfigOption(params);
    if (response.configOptions) {
      response.configOptions = normalizeOpencodeConfigOptions(
        response.configOptions,
      ) as typeof response.configOptions;
      this.sessionState.configOptions = response.configOptions ?? [];
    }
    return response;
  }

  async authenticate(): Promise<void> {
    // Auth is handled externally (gateway token injected at spawn).
  }

  async closeSession(): Promise<void> {
    this.logger.info("Closing opencode session", { sessionId: this.sessionId });
    this.session.abortController.abort();
    this.session.settingsManager.dispose();
    try {
      this.opencodeProcess.kill();
    } catch (err) {
      this.logger.warn("Failed to kill opencode process", { error: err });
    }
  }
}
