import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type {
  Agent,
  AgentSideConnection,
  AuthenticateRequest,
  CancelNotification,
  ForkSessionRequest,
  ForkSessionResponse,
  InitializeRequest,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SessionConfigOption,
} from "@agentclientprotocol/sdk";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type {
  AgentSession,
  EditToolInput,
} from "@earendil-works/pi-coding-agent";
import {
  acpPromptToPi,
  buildEditDiffUpdate,
  buildHarnessModelSurface,
  createHarnessAcpTranslator,
  type PiToolResult,
  replayPiMessages,
} from "@posthog/harness/acp";
import {
  createHarnessSession,
  findHarnessSessionPath,
} from "@posthog/harness/session";
import { POSTHOG_NOTIFICATIONS } from "../../acp-extensions";
import { Logger } from "../../utils/logger";

const HOG_ADAPTER = "hog";

interface HarnessSessionMeta {
  taskRunId?: string;
}

interface HarnessAcpAgentOptions {
  allowedModelIds?: Set<string>;
  gatewayUrl?: string;
  apiKey?: string;
}

type ModelState = ReturnType<typeof buildHarnessModelSurface>;

export class HarnessAcpAgent implements Agent {
  readonly adapterName = HOG_ADAPTER;
  private logger: Logger;
  private sessionId: string | null = null;
  private session: AgentSession | null = null;
  private cancelled = false;
  private cwd: string | null = null;

  constructor(
    private client: AgentSideConnection,
    private options: HarnessAcpAgentOptions = {},
  ) {
    this.logger = new Logger({ debug: true, prefix: "[HarnessAcpAgent]" });
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        _meta: { posthog: { steering: "native" } },
        loadSession: true,
        promptCapabilities: {
          image: true,
          audio: false,
          embeddedContext: true,
        },
        sessionCapabilities: {
          list: {},
          fork: {},
          resume: {},
        },
      },
      authMethods: [],
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const session = await this.openSession(params.cwd, this.meta(params));
    return { sessionId: session.sessionId, ...this.buildModelState() };
  }

  async resumeSession(
    params: ResumeSessionRequest,
  ): Promise<ResumeSessionResponse> {
    await this.openSession(params.cwd, this.meta(params), {
      requestedSessionId: params.sessionId,
    });
    return this.buildModelState();
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const session = await this.openSession(params.cwd, this.meta(params), {
      requestedSessionId: params.sessionId,
    });
    for (const update of replayPiMessages(session.messages)) {
      await this.client.sessionUpdate({
        sessionId: session.sessionId,
        update,
      });
    }
    return this.buildModelState();
  }

  async listSessions(
    params: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    const infos = params.cwd
      ? await findSessionsForCwd(params.cwd)
      : await findAllSessions();
    return {
      sessions: infos.map((info) => ({
        sessionId: info.id,
        cwd: info.cwd,
        title: info.name ?? null,
        updatedAt: info.modified.toISOString(),
      })),
    };
  }

  async unstable_forkSession(
    params: ForkSessionRequest,
  ): Promise<ForkSessionResponse> {
    const sourcePath = await findHarnessSessionPath(
      params.cwd,
      params.sessionId,
    );
    if (!sourcePath) {
      throw new Error(
        `No harness session ${params.sessionId} found under ${params.cwd}`,
      );
    }

    const source = await createHarnessSession({
      cwd: params.cwd,
      gatewayUrl: this.options.gatewayUrl,
      apiKey: this.options.apiKey,
      loadFromPath: sourcePath,
    });

    try {
      const leafId = source.sessionManager.getLeafId();
      const forkedPath = leafId
        ? source.sessionManager.createBranchedSession(leafId)
        : undefined;
      if (!forkedPath) {
        const session = await this.openSession(params.cwd, this.meta(params));
        return { sessionId: session.sessionId, ...this.buildModelState() };
      }
      const forked = await this.openSession(params.cwd, this.meta(params), {
        loadFromPath: forkedPath,
      });
      return { sessionId: forked.sessionId, ...this.buildModelState() };
    } finally {
      source.dispose();
    }
  }

  private async openSession(
    cwd: string,
    meta: HarnessSessionMeta | undefined,
    options: { requestedSessionId?: string; loadFromPath?: string } = {},
  ): Promise<AgentSession> {
    let loadFromPath = options.loadFromPath;
    if (!loadFromPath && options.requestedSessionId) {
      loadFromPath = await findHarnessSessionPath(
        cwd,
        options.requestedSessionId,
      );
      if (!loadFromPath) {
        throw new Error(
          `No harness session ${options.requestedSessionId} found under ${cwd}`,
        );
      }
    }

    const session = await createHarnessSession({
      cwd,
      gatewayUrl: this.options.gatewayUrl,
      apiKey: this.options.apiKey,
      ...(loadFromPath ? { loadFromPath } : {}),
    });
    this.session?.dispose();
    this.session = session;
    this.sessionId = session.sessionId;
    this.cwd = cwd;

    this.logger.info(
      loadFromPath ? "Resumed harness session" : "Created harness session",
      {
        sessionId: this.sessionId,
        ...(loadFromPath
          ? { path: loadFromPath, messageCount: session.messages.length }
          : {}),
      },
    );

    if (meta?.taskRunId) {
      await this.client.extNotification(POSTHOG_NOTIFICATIONS.SDK_SESSION, {
        taskRunId: meta.taskRunId,
        sessionId: this.sessionId,
        adapter: HOG_ADAPTER,
      });
    }

    return session;
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.requireActive(params.sessionId);
    this.cancelled = false;

    const translate = createHarnessAcpTranslator({
      resolveContextWindow: (modelId: string) =>
        session.modelRegistry.find("posthog", modelId)?.contextWindow,
    });
    let finalStopReason: PromptResponse["stopReason"] | null = null;
    let lastUsage:
      | {
          inputTokens: number;
          outputTokens: number;
          cachedReadTokens: number;
          cachedWriteTokens: number;
          totalTokens: number;
        }
      | undefined;

    const editArgsByToolCallId = new Map<string, EditToolInput>();

    const unsubscribe = session.subscribe((event) => {
      if (event.type === "tool_execution_start" && event.toolName === "edit") {
        editArgsByToolCallId.set(event.toolCallId, event.args as EditToolInput);
      }
      if (event.type === "turn_end") {
        const message = event.message;
        if (message && "role" in message && message.role === "assistant") {
          lastUsage = {
            inputTokens: message.usage?.input ?? 0,
            outputTokens: message.usage?.output ?? 0,
            cachedReadTokens: message.usage?.cacheRead ?? 0,
            cachedWriteTokens: message.usage?.cacheWrite ?? 0,
            totalTokens:
              (message.usage?.input ?? 0) +
              (message.usage?.output ?? 0) +
              (message.usage?.cacheRead ?? 0) +
              (message.usage?.cacheWrite ?? 0),
          };
        }
      }
      const { update, stopReason } = translate(event);
      if (update) {
        void this.client.sessionUpdate({
          sessionId: params.sessionId,
          update,
        });
      }
      if (stopReason) finalStopReason = stopReason;

      if (event.type === "tool_execution_end" && event.toolName === "edit") {
        const editArgs = editArgsByToolCallId.get(event.toolCallId);
        editArgsByToolCallId.delete(event.toolCallId);
        if (editArgs && !event.isError) {
          const resultContent =
            (event.result as PiToolResult | undefined)?.content ?? [];
          this.enrichEditDiff(
            params.sessionId,
            event.toolCallId,
            editArgs,
            resultContent,
          );
        }
      }
    });

    try {
      for (const block of params.prompt) {
        if (block.type === "text") {
          await this.client.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "user_message_chunk",
              content: { type: "text", text: block.text },
            },
          });
        } else if (block.type === "image") {
          await this.client.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "user_message_chunk",
              content: {
                type: "image",
                data: block.data,
                mimeType: block.mimeType,
              },
            },
          });
        }
      }

      const { text, images } = await acpPromptToPi(params.prompt, {
        readTextFile: async (path: string) => {
          const res = await this.client.readTextFile({
            sessionId: params.sessionId,
            path,
          });
          return res.content;
        },
      });

      const meta =
        (params._meta as
          | { prContext?: unknown; steer?: unknown }
          | undefined) ?? {};
      const prContext =
        typeof meta.prContext === "string" && meta.prContext.trim().length > 0
          ? `${meta.prContext.trim()}\n\n`
          : "";
      const promptText = `${prContext}${text}`;
      const promptOptions = images.length > 0 ? { images } : undefined;

      const wasStreaming = session.isStreaming;
      const shouldSteer = !!meta.steer || wasStreaming;
      if (shouldSteer) {
        await session.prompt(promptText, {
          ...promptOptions,
          streamingBehavior: "steer",
        });
      } else {
        await session.prompt(promptText, promptOptions);
      }

      const stopReason = this.cancelled
        ? "cancelled"
        : (finalStopReason ?? "end_turn");

      if (lastUsage && !wasStreaming) {
        await this.client.extNotification(POSTHOG_NOTIFICATIONS.TURN_COMPLETE, {
          sessionId: params.sessionId,
          stopReason,
          usage: lastUsage,
        });
      }

      return { stopReason };
    } catch (err) {
      this.logger.error("Harness prompt failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      unsubscribe();
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    if (params.sessionId !== this.sessionId || !this.session) return;
    this.cancelled = true;
    this.logger.info("Cancel requested, aborting harness session");
    try {
      await this.session.abort();
    } catch (err) {
      this.logger.warn("Harness abort failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async setSessionConfigOption(params: {
    sessionId: string;
    configId: string;
    value?: unknown;
  }): Promise<{ configOptions: SessionConfigOption[] }> {
    this.requireActive(params.sessionId);
    if (params.configId !== "model") {
      return { configOptions: this.buildModelState().configOptions ?? [] };
    }
    await this.setModelById(String(params.value));
    return { configOptions: this.buildModelState().configOptions ?? [] };
  }

  async authenticate(_params: AuthenticateRequest): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async closeSession(): Promise<void> {
    this.session?.dispose();
    this.session = null;
    this.sessionId = null;
  }

  private requireActive(sessionId: string): AgentSession {
    if (!this.session || sessionId !== this.sessionId) {
      throw new Error("No active harness session");
    }
    return this.session;
  }

  /**
   * Upgrades an `edit` tool call's reported content from a raw diff string
   * to a proper `{type: "diff"}` block once the post-edit file content is
   * available, sent as a follow-up `tool_call_update` for the same
   * `toolCallId`. Best-effort: silently no-ops if the file can't be read, if
   * the edit can't be safely reconstructed (see `reconstructEditOldText`),
   * or if the session has since moved on — the initial update already
   * carried a usable (if less rich) diff, so there's nothing to fall back
   * to here.
   *
   * The read is deliberately synchronous (`readFileSync`), called directly
   * from the `tool_execution_end` handler rather than from an awaited async
   * function. Node's single JS thread can't run any other code — including
   * a subsequent edit to the same file — between when this event fires and
   * when the sync read returns, which is what keeps this race-free. An
   * awaited async read here would yield back to the event loop first,
   * leaving a window where a second edit to the same file could land
   * before the read runs, producing a diff that mixes in that later edit's
   * changes.
   */
  private enrichEditDiff(
    sessionId: string,
    toolCallId: string,
    editArgs: EditToolInput,
    resultContent: PiToolResult["content"],
  ): void {
    if (!this.cwd) return;
    let postEditContent: string;
    try {
      postEditContent = readFileSync(
        resolvePath(this.cwd, editArgs.path),
        "utf-8",
      );
    } catch {
      return;
    }
    if (sessionId !== this.sessionId) return;
    const update = buildEditDiffUpdate(
      toolCallId,
      editArgs.path,
      editArgs.edits,
      postEditContent,
      resultContent,
    );
    if (!update) return;
    void this.client.sessionUpdate({ sessionId, update }).catch((err) => {
      this.logger.warn("Failed to send edit diff upgrade", {
        toolCallId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private meta(params: { _meta?: unknown }): HarnessSessionMeta | undefined {
    return params._meta as HarnessSessionMeta | undefined;
  }

  private buildModelState(): ModelState {
    if (!this.session) return {};
    const all = this.session.modelRegistry.getAvailable();
    const filtered = this.options.allowedModelIds
      ? all.filter((model) => this.options.allowedModelIds?.has(model.id))
      : all;
    return buildHarnessModelSurface(filtered, this.session.model?.id);
  }

  private async setModelById(modelId: string): Promise<void> {
    const session = this.requireActive(this.sessionId ?? "");
    const model = session.modelRegistry.find("posthog", modelId);
    if (!model) {
      throw new Error(
        `Model ${modelId} not in registry or has no auth configured`,
      );
    }
    await session.setModel(model);
    this.logger.info("Set harness session model", { modelId });
  }
}

async function findSessionsForCwd(
  cwd: string,
): Promise<
  Awaited<
    ReturnType<
      typeof import("@earendil-works/pi-coding-agent")["SessionManager"]["list"]
    >
  >
> {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  return SessionManager.list(cwd);
}

async function findAllSessions(): Promise<
  Awaited<
    ReturnType<
      typeof import("@earendil-works/pi-coding-agent")["SessionManager"]["listAll"]
    >
  >
> {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  return SessionManager.listAll();
}
