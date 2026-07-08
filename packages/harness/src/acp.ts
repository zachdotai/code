import type {
  ContentBlock,
  ModelInfo,
  SessionConfigOption,
  SessionModelState,
  SessionUpdate,
  StopReason,
  ToolCallContent,
  ToolCallLocation,
  ToolKind,
} from "@agentclientprotocol/sdk";
import type {
  Api,
  ImageContent,
  Model,
  StopReason as PiStopReason,
  TextContent,
} from "@earendil-works/pi-ai";
import type {
  AgentSession,
  AgentSessionEvent,
  BashToolInput,
  EditToolDetails,
  EditToolInput,
  GrepToolInput,
  LsToolInput,
  ReadToolInput,
  WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import { POSTHOG_PROVIDER_NAME } from "./extensions/posthog-provider/provider";

export interface PiToolResult<TDetails = unknown> {
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError?: boolean;
}

// No leading `\s*` here: paired with the unanchored search .replace() does by
// default, a leading quantifier in front of a literal makes the engine retry
// every possible split of \s* at every start position when the literal isn't
// found, which is quadratic on a run of whitespace. The trailing .trimEnd()
// below gets the same "trim surrounding whitespace" behavior without it.
const LATEST_SUFFIX = /\(latest\)\s*$/i;
const LATEST_MARKER = /\(latest\)/i;

function stripLatestSuffix(name: string): string {
  return name.replace(LATEST_SUFFIX, "").trimEnd();
}

function dedupeToLatest<T extends Model<Api>>(models: T[]): T[] {
  const byName = new Map<string, T>();
  for (const model of models) {
    const base = stripLatestSuffix(model.name);
    const existing = byName.get(base);
    if (
      !existing ||
      (LATEST_MARKER.test(model.name) && !LATEST_MARKER.test(existing.name))
    ) {
      byName.set(base, model);
    }
  }
  return Array.from(byName.values());
}

export function buildHarnessModelSurface(
  available: Array<Model<Api>>,
  currentModelId: string | undefined,
): { models?: SessionModelState; configOptions?: SessionConfigOption[] } {
  const deduped = dedupeToLatest(
    available.filter((model) => model.provider === POSTHOG_PROVIDER_NAME),
  );
  if (deduped.length === 0) return {};

  const items = deduped.map((model) => ({
    id: model.id,
    name: stripLatestSuffix(model.name),
  }));
  const currentId =
    currentModelId && items.some((item) => item.id === currentModelId)
      ? currentModelId
      : items[0]?.id;
  if (!currentId) return {};

  const availableModels: ModelInfo[] = items.map(({ id, name }) => ({
    modelId: id,
    name,
  }));
  const modelOption: SessionConfigOption = {
    id: "model",
    name: "Model",
    type: "select",
    currentValue: currentId,
    options: items.map(({ id, name }) => ({ value: id, name })),
    category: "model",
    description: "Choose which model the agent should use",
  };

  return {
    models: { availableModels, currentModelId: currentId },
    configOptions: [modelOption],
  };
}

export interface AcpPromptToPiOptions {
  readTextFile?: (path: string) => Promise<string>;
}

function fileUriToPath(uri: string): string | undefined {
  if (!uri.startsWith("file://")) return undefined;
  try {
    return decodeURIComponent(new URL(uri).pathname);
  } catch {
    return undefined;
  }
}

function wrapFile(pathOrUri: string, content: string): string {
  return `<file path="${pathOrUri}">\n${content}\n</file>\n`;
}

export async function acpPromptToPi(
  prompt: ContentBlock[],
  options: AcpPromptToPiOptions = {},
): Promise<{ text: string; images: ImageContent[] }> {
  const textParts: string[] = [];
  const images: ImageContent[] = [];

  for (const block of prompt) {
    if (block.type === "text") {
      textParts.push(block.text);
      continue;
    }

    if (block.type === "image") {
      images.push({
        type: "image",
        data: block.data,
        mimeType: block.mimeType,
      });
      continue;
    }

    if (block.type === "resource") {
      const resource = block.resource;
      if ("text" in resource) {
        textParts.push(wrapFile(resource.uri, resource.text));
      }
      continue;
    }

    if (block.type === "resource_link") {
      const path = fileUriToPath(block.uri);
      if (path && options.readTextFile) {
        try {
          const content = await options.readTextFile(path);
          textParts.push(wrapFile(path, content));
          continue;
        } catch {
          // Fall through to an inline URI reference.
        }
      }
      textParts.push(`<resource uri="${block.uri}" />\n`);
    }
  }

  return { text: textParts.join(""), images };
}

const KIND_BY_TOOL: Record<string, ToolKind> = {
  read: "read",
  ls: "read",
  bash: "execute",
  edit: "edit",
  write: "edit",
  grep: "search",
  find: "search",
};

function locationsFor(
  toolName: string,
  args: unknown,
): ToolCallLocation[] | undefined {
  switch (toolName) {
    case "read": {
      const input = args as ReadToolInput;
      return [
        {
          path: input.path,
          ...(input.offset ? { line: input.offset } : {}),
        },
      ];
    }
    case "edit":
      return [{ path: (args as EditToolInput).path }];
    case "write":
      return [{ path: (args as WriteToolInput).path }];
    case "ls": {
      const path = (args as LsToolInput).path;
      return path ? [{ path }] : undefined;
    }
    default:
      return undefined;
  }
}

function titleFor(toolName: string, args: unknown): string {
  switch (toolName) {
    case "read":
      return `Read ${(args as ReadToolInput).path}`;
    case "ls":
      return `List ${(args as LsToolInput).path}`;
    case "edit":
      return `Edit ${(args as EditToolInput).path}`;
    case "write":
      return `Write ${(args as WriteToolInput).path}`;
    case "bash": {
      const command = (args as BashToolInput).command;
      return command.split("\n")[0]?.slice(0, 80) ?? "bash";
    }
    case "grep":
      return `Grep ${(args as GrepToolInput).pattern}`;
    case "find": {
      const input = args as { pattern?: string; name?: string };
      return `Find ${input.pattern ?? input.name ?? ""}`.trim();
    }
    default:
      return toolName;
  }
}

function buildToolCallStart(
  toolCallId: string,
  toolName: string,
  args: unknown,
): SessionUpdate {
  const locations = locationsFor(toolName, args);
  return {
    sessionUpdate: "tool_call",
    toolCallId,
    title: titleFor(toolName, args),
    kind: KIND_BY_TOOL[toolName] ?? "other",
    status: "in_progress",
    rawInput: args,
    ...(locations ? { locations } : {}),
  };
}

function piContentToAcp(
  content: (TextContent | ImageContent)[],
): ToolCallContent[] {
  return content.map((item) =>
    item.type === "text"
      ? { type: "content", content: { type: "text", text: item.text } }
      : {
          type: "content",
          content: {
            type: "image",
            data: item.data,
            mimeType: item.mimeType,
          },
        },
  );
}

function endContent(
  toolName: string,
  args: unknown,
  result: PiToolResult,
): ToolCallContent[] {
  const items: ToolCallContent[] = [];

  switch (toolName) {
    case "write": {
      const input = args as WriteToolInput;
      items.push({
        type: "diff",
        path: input.path,
        oldText: null,
        newText: input.content,
      });
      break;
    }
    case "edit": {
      const details = result.details as EditToolDetails | undefined;
      if (details?.diff) {
        items.push({
          type: "content",
          content: { type: "text", text: details.diff },
        });
      }
      break;
    }
  }

  items.push(...piContentToAcp(result.content));
  return items;
}

/**
 * Reverses a single edit against the post-edit file content to recover the
 * pre-edit full file text, so the client can render a proper before/after
 * diff instead of a raw patch string.
 *
 * Pi's actual edit tool matches `oldText` with fuzzy normalization and
 * applies replacements at resolved offsets against the original content (see
 * `applyEditsToNormalizedContent` in pi-coding-agent) rather than by
 * re-searching text sequentially. Blindly replaying multiple edits in
 * reverse over the same content string doesn't have access to those
 * resolved offsets and can pick the wrong occurrence, so this only attempts
 * the single-edit, unambiguous case (exactly one `{oldText, newText}` pair
 * whose `newText` appears exactly once in the post-edit content). Anything
 * else returns `undefined` and callers should keep the existing raw-diff
 * fallback.
 */
export function reconstructEditOldText(
  postEditContent: string,
  edits: EditToolInput["edits"],
): string | undefined {
  if (edits.length !== 1) return undefined;
  const { oldText, newText } = edits[0];
  const firstIndex = postEditContent.indexOf(newText);
  if (firstIndex === -1) return undefined;
  if (postEditContent.indexOf(newText, firstIndex + 1) !== -1) {
    return undefined;
  }
  return (
    postEditContent.slice(0, firstIndex) +
    oldText +
    postEditContent.slice(firstIndex + newText.length)
  );
}

/**
 * Builds a follow-up `tool_call_update` upgrading an `edit` tool call's
 * content from the raw diff text emitted at completion time to a proper
 * `{type: "diff"}` block, once the post-edit file content is available.
 * Callers read the file synchronously right when `tool_execution_end` fires
 * (see `enrichEditDiff` in harness-agent.ts — using `readFileSync` there,
 * not an awaited read, is what keeps this race-free against a second edit
 * to the same file) and send this as a second update for the same
 * `toolCallId` — the same pattern already used for `tool_execution_update`
 * partial-progress content.
 *
 * The client replaces a tool call's `content` wholesale on each update
 * (see `buildConversationItems.ts`'s `Object.assign`), so `resultContent`
 * — the same `result.content` the initial completion update included via
 * `piContentToAcp` — must be carried forward here too, or the upgrade
 * silently erases any content the edit tool itself returned.
 *
 * Returns `undefined` when the edit can't be safely reconstructed (see
 * {@link reconstructEditOldText}), in which case callers should skip sending
 * an upgrade and leave the raw-diff-as-text content from the initial update.
 */
export function buildEditDiffUpdate(
  toolCallId: string,
  path: string,
  edits: EditToolInput["edits"],
  postEditContent: string,
  resultContent: PiToolResult["content"],
): SessionUpdate | undefined {
  const oldText = reconstructEditOldText(postEditContent, edits);
  if (oldText === undefined) return undefined;
  return {
    sessionUpdate: "tool_call_update",
    toolCallId,
    content: [
      { type: "diff", path, oldText, newText: postEditContent },
      ...piContentToAcp(resultContent),
    ],
  };
}

function buildToolCallEnd(
  toolCallId: string,
  toolName: string,
  args: unknown,
  result: PiToolResult,
  isError: boolean,
): SessionUpdate {
  return {
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: isError ? "failed" : "completed",
    content: endContent(toolName, args, result),
  };
}

function piStopReasonToAcp(reason: PiStopReason): StopReason {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "toolUse":
      return "max_turn_requests";
    case "aborted":
      return "cancelled";
    case "error":
      return "refusal";
  }
}

export type ContextWindowResolver = (modelId: string) => number | undefined;

export interface HarnessTranslateResult {
  update?: SessionUpdate;
  stopReason?: StopReason;
}

export function createHarnessAcpTranslator(options: {
  resolveContextWindow: ContextWindowResolver;
}): (event: AgentSessionEvent) => HarnessTranslateResult {
  const { resolveContextWindow } = options;
  const argsByToolCallId = new Map<string, unknown>();
  let cumulativeCostUsd = 0;

  return (event: AgentSessionEvent): HarnessTranslateResult => {
    if (event.type === "message_update") {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") {
        return {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: inner.delta },
          },
        };
      }
      if (inner.type === "thinking_delta") {
        return {
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: inner.delta },
          },
        };
      }
      return {};
    }

    if (event.type === "tool_execution_start") {
      argsByToolCallId.set(event.toolCallId, event.args);
      return {
        update: buildToolCallStart(
          event.toolCallId,
          event.toolName,
          event.args,
        ),
      };
    }

    if (event.type === "tool_execution_update") {
      const partial = event.partialResult as PiToolResult | null | undefined;
      if (!partial?.content?.length) return {};
      return {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolCallId,
          content: piContentToAcp(partial.content),
        },
      };
    }

    if (event.type === "tool_execution_end") {
      const args = argsByToolCallId.get(event.toolCallId);
      argsByToolCallId.delete(event.toolCallId);
      return {
        update: buildToolCallEnd(
          event.toolCallId,
          event.toolName,
          args,
          event.result as PiToolResult,
          event.isError,
        ),
      };
    }

    if (event.type === "turn_end") {
      const message = event.message;
      if (!message || !("role" in message) || message.role !== "assistant") {
        return {};
      }
      if (!message.usage) return {};
      cumulativeCostUsd += message.usage.cost?.total ?? 0;
      const size = resolveContextWindow(message.model);
      if (size === undefined) return {};
      return {
        update: {
          sessionUpdate: "usage_update",
          size,
          used: (message.usage.input ?? 0) + (message.usage.output ?? 0),
          cost: { amount: cumulativeCostUsd, currency: "USD" },
        },
      };
    }

    if (event.type === "agent_end") {
      for (let i = event.messages.length - 1; i >= 0; i--) {
        const message = event.messages[i];
        if (message && "role" in message && message.role === "assistant") {
          return { stopReason: piStopReasonToAcp(message.stopReason) };
        }
      }
    }

    return {};
  };
}

export function replayPiMessages(
  messages: AgentSession["messages"],
): SessionUpdate[] {
  const updates: SessionUpdate[] = [];
  const argsByToolCallId = new Map<string, unknown>();

  for (const message of messages) {
    if (!("role" in message)) continue;

    if (message.role === "user") {
      const items =
        typeof message.content === "string"
          ? message.content
            ? [{ type: "text" as const, text: message.content }]
            : []
          : message.content;

      for (const item of items) {
        if (item.type === "text" && item.text) {
          updates.push({
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: item.text },
          });
        } else if (item.type === "image") {
          updates.push({
            sessionUpdate: "user_message_chunk",
            content: {
              type: "image",
              data: item.data,
              mimeType: item.mimeType,
            },
          });
        }
      }
      continue;
    }

    if (message.role === "assistant") {
      for (const item of message.content) {
        if (item.type === "text" && item.text) {
          updates.push({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: item.text },
          });
        } else if (item.type === "thinking" && item.thinking) {
          updates.push({
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: item.thinking },
          });
        } else if (item.type === "toolCall") {
          argsByToolCallId.set(item.id, item.arguments);
          updates.push(buildToolCallStart(item.id, item.name, item.arguments));
        }
      }
      continue;
    }

    if (message.role === "toolResult") {
      const args = argsByToolCallId.get(message.toolCallId);
      argsByToolCallId.delete(message.toolCallId);
      updates.push(
        buildToolCallEnd(
          message.toolCallId,
          message.toolName,
          args,
          {
            content: message.content,
            details: message.details,
            isError: message.isError,
          },
          message.isError,
        ),
      );
    }
  }

  return updates;
}
