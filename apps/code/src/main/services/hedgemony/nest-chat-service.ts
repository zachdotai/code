import { inject, injectable } from "inversify";
import type { NestMessageRepository } from "../../db/repositories/nest-message-repository";
import { MAIN_TOKENS } from "../../di/tokens";
import type {
  CreateNestInput,
  GoalDraftTranscriptMessage,
  ListNestChatInput,
  Nest,
  NestMessage,
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

  recordCreationContext(nest: Nest, input: CreateNestInput): void {
    const creationTranscript =
      input.creationTranscript && input.creationTranscript.length > 0
        ? input.creationTranscript
        : buildFallbackTranscript(input);

    this.messages.create({
      nestId: nest.id,
      kind: "user_message",
      body: formatCreationContext(input, creationTranscript),
      payloadJson: JSON.stringify({
        creationMode: input.creationMode ?? "guided",
        planningMethod: SPEC_DRIVEN_DEVELOPMENT_METHOD,
        goalPrompt: input.goalPrompt,
        definitionOfDone: input.definitionOfDone ?? null,
        creationTranscript,
      }),
    });

    this.messages.create({
      nestId: nest.id,
      kind: "audit",
      body: `Nest created at (${nest.mapX}, ${nest.mapY}).`,
      payloadJson: JSON.stringify({
        mapX: nest.mapX,
        mapY: nest.mapY,
        status: nest.status,
      }),
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

  return `Creation transcript\n\n${transcriptBody}\n\nAccepted spec\n\n${acceptedSpec}`;
}
