import { inject, injectable } from "inversify";
import type { NestMessageRepository } from "../../db/repositories/nest-message-repository";
import { MAIN_TOKENS } from "../../di/tokens";
import type {
  CompleteNestInput,
  CreateNestInput,
  ForgetCompletedNestContextInput,
  GoalDraftTranscriptMessage,
  ListNestChatInput,
  Nest,
  NestMessage,
  RecordBootstrapHandoffInput,
  SendNestMessageInput,
} from "./schemas";
import { SPEC_DRIVEN_DEVELOPMENT_METHOD } from "./spec-driven-development";

@injectable()
export class NestChatService {
  constructor(
    @inject(MAIN_TOKENS.NestMessageRepository)
    private readonly messages: NestMessageRepository,
  ) {}

  list(input: ListNestChatInput): NestMessage[] {
    const messages = this.messages.listByNestId(input.nestId);
    if (input.detail) {
      return messages;
    }
    return messages.filter((message) => message.visibility === "summary");
  }

  recordCreationContext(nest: Nest, input: CreateNestInput): NestMessage[] {
    const creationTranscript =
      input.creationTranscript && input.creationTranscript.length > 0
        ? input.creationTranscript
        : buildFallbackTranscript(input);

    const transcriptMessage = this.messages.create({
      nestId: nest.id,
      kind: "user_message",
      body: formatCreationContext(input, creationTranscript),
      payloadJson: JSON.stringify({
        creationMode: input.creationMode ?? "guided",
        planningMethod: SPEC_DRIVEN_DEVELOPMENT_METHOD,
        goalPrompt: input.goalPrompt,
        definitionOfDone: input.definitionOfDone ?? null,
        creationTranscript,
        creationBootstrap: input.creationBootstrap ?? null,
      }),
    });

    const auditMessage = this.messages.create({
      nestId: nest.id,
      kind: "audit",
      body: `Nest created at (${nest.mapX}, ${nest.mapY}).`,
      payloadJson: JSON.stringify({
        mapX: nest.mapX,
        mapY: nest.mapY,
        status: nest.status,
      }),
    });

    return [transcriptMessage, auditMessage];
  }

  recordBootstrapHandoff(input: RecordBootstrapHandoffInput): NestMessage {
    const existing = this.messages
      .listByNestId(input.nestId)
      .find(
        (message) =>
          message.sourceTaskId === input.taskId &&
          getPayloadType(message.payloadJson) === "bootstrap_handoff_final",
      );
    if (existing) return existing;

    return this.messages.create({
      nestId: input.nestId,
      kind: "tool_result",
      visibility: "summary",
      sourceTaskId: input.taskId,
      body: formatBootstrapHandoff(input),
      payloadJson: JSON.stringify({
        type: "bootstrap_handoff_final",
        taskId: input.taskId,
        runId: input.runId ?? null,
        repositories: input.repositories,
        primaryRepository: input.primaryRepository ?? null,
        handoffMarkdown: input.handoffMarkdown,
        outputJson: input.outputJson ?? null,
      }),
    });
  }

  recordCompletionContext(nest: Nest, input: CompleteNestInput): NestMessage {
    const compaction = this.messages.compactCompletedContext(nest.id);

    return this.messages.create({
      nestId: nest.id,
      kind: "audit",
      body: formatCompletionContext(input, compaction),
      payloadJson: JSON.stringify({
        type: "nest_completed",
        summary: input.summary,
        prUrls: input.prUrls ?? [],
        taskIds: input.taskIds ?? [],
        caveats: input.caveats ?? [],
        compaction,
      }),
    });
  }

  forgetCompletedContext(
    nest: Nest,
    input: ForgetCompletedNestContextInput,
  ): NestMessage {
    const compaction = this.messages.compactCompletedContext(nest.id);

    return this.messages.create({
      nestId: nest.id,
      kind: "audit",
      body: formatForgetCompletedContext(input, compaction),
      payloadJson: JSON.stringify({
        type: "completed_context_forgotten",
        reason: input.reason ?? null,
        compaction,
      }),
    });
  }

  /**
   * Writes an operator chat message (`kind: "user_message"`) to a nest.
   * Returned message is emitted as a `message_appended` event by the caller
   * via NestService so live subscribers see it without a separate watch.
   */
  send(input: SendNestMessageInput): NestMessage {
    return this.messages.create({
      nestId: input.nestId,
      kind: "user_message",
      visibility: "summary",
      body: input.body,
      payloadJson: JSON.stringify({ source: "operator_chat" }),
    });
  }

  /**
   * Generic writer used by HedgehogTickService for `hedgehog_message`,
   * `audit`, and `tool_result` rows. The caller (tick service) owns emission
   * of `message_appended` through NestService after this returns.
   */
  recordHedgehogMessage(input: {
    nestId: string;
    kind: "hedgehog_message" | "audit" | "tool_result";
    body: string;
    payloadJson?: Record<string, unknown> | null;
    visibility?: "summary" | "detail";
    sourceTaskId?: string | null;
  }): NestMessage {
    return this.messages.create({
      nestId: input.nestId,
      kind: input.kind,
      visibility: input.visibility ?? "summary",
      body: input.body,
      sourceTaskId: input.sourceTaskId ?? null,
      payloadJson:
        input.payloadJson === undefined || input.payloadJson === null
          ? null
          : JSON.stringify(input.payloadJson),
    });
  }
}

function buildFallbackTranscript(
  input: CreateNestInput,
): GoalDraftTranscriptMessage[] {
  const mode = input.creationMode ?? "guided";
  return [
    {
      role: "user",
      content:
        mode === "simple"
          ? `Created through simple form.\n\nName: ${input.name}\n\nSpec: ${input.goalPrompt}`
          : `Created from accepted goal draft.\n\nName: ${input.name}\n\nSpec: ${input.goalPrompt}`,
    },
  ];
}

function formatCreationContext(
  input: CreateNestInput,
  transcript: GoalDraftTranscriptMessage[],
): string {
  const transcriptBody = transcript
    .map((message) => {
      const label = message.role === "user" ? "Operator" : "Goal draft";
      return `${label}: ${message.content}`;
    })
    .join("\n\n");

  const acceptedSpec = [
    `Name: ${input.name}`,
    `Spec: ${input.goalPrompt}`,
    input.definitionOfDone
      ? `Definition of done: ${input.definitionOfDone}`
      : "Definition of done: not set yet",
    `Planning method: ${SPEC_DRIVEN_DEVELOPMENT_METHOD}`,
  ].join("\n");

  const bootstrap = input.creationBootstrap
    ? formatBootstrapContext(input.creationBootstrap)
    : null;

  return [
    "Creation transcript",
    transcriptBody,
    "Accepted spec",
    acceptedSpec,
    bootstrap ? "Bootstrap handoff" : null,
    bootstrap,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatBootstrapContext(
  bootstrap: NonNullable<CreateNestInput["creationBootstrap"]>,
): string {
  const repositories =
    bootstrap.repositories.length > 0
      ? bootstrap.repositories.join(", ")
      : "inferred from natural language";
  return [
    `Mode: ${bootstrap.mode}`,
    bootstrap.taskId ? `Bootstrap task: ${bootstrap.taskId}` : null,
    `Primary repository: ${bootstrap.primaryRepository ?? "not set"}`,
    `Repositories: ${repositories}`,
    "Prompt:",
    bootstrap.prompt,
    "Handoff:",
    bootstrap.handoffInstructions,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatBootstrapHandoff(input: RecordBootstrapHandoffInput): string {
  const repositories =
    input.repositories.length > 0 ? input.repositories.join(", ") : "unknown";
  return [
    "Bootstrap handoff captured",
    `Bootstrap task: ${input.taskId}`,
    input.runId ? `Bootstrap run: ${input.runId}` : null,
    `Primary repository: ${input.primaryRepository ?? "not set"}`,
    `Repositories: ${repositories}`,
    "Final handoff:",
    input.handoffMarkdown,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function getPayloadType(payloadJson: string | null): string | null {
  if (!payloadJson) return null;
  try {
    const payload = JSON.parse(payloadJson) as { type?: unknown };
    return typeof payload.type === "string" ? payload.type : null;
  } catch {
    return null;
  }
}

function formatCompletionContext(
  input: CompleteNestInput,
  compaction: {
    deletedDetailMessages: number;
    compactedContextMessages: number;
  },
): string {
  return [
    "Nest completed",
    input.summary,
    input.prUrls && input.prUrls.length > 0
      ? `PRs: ${input.prUrls.join(", ")}`
      : null,
    input.taskIds && input.taskIds.length > 0
      ? `Tasks: ${input.taskIds.join(", ")}`
      : null,
    input.caveats && input.caveats.length > 0
      ? `Caveats: ${input.caveats.join("; ")}`
      : null,
    `Compacted context: deleted ${compaction.deletedDetailMessages} detail rows, compacted ${compaction.compactedContextMessages} context rows.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatForgetCompletedContext(
  input: ForgetCompletedNestContextInput,
  compaction: {
    deletedDetailMessages: number;
    compactedContextMessages: number;
  },
): string {
  return [
    "Completed nest context forgotten",
    input.reason ? `Reason: ${input.reason}` : null,
    `Compacted context: deleted ${compaction.deletedDetailMessages} detail rows, compacted ${compaction.compactedContextMessages} context rows.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
