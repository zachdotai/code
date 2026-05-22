import type {
  CompactNestContextResult,
  CreateNestMessageData,
  NestMessage,
} from "./nest-message-repository";

export interface MockNestMessageRepository {
  _messages: NestMessage[];
  listByNestId(nestId: string): NestMessage[];
  create(data: CreateNestMessageData): NestMessage;
  compactCompletedContext(nestId: string): CompactNestContextResult;
}

export function createMockNestMessageRepository(): MockNestMessageRepository {
  const messages: NestMessage[] = [];

  return {
    _messages: messages,
    listByNestId: (nestId: string) =>
      messages.filter((m) => m.nestId === nestId).map((m) => ({ ...m })),
    create: (data: CreateNestMessageData) => {
      const message: NestMessage = {
        id: crypto.randomUUID(),
        nestId: data.nestId,
        kind: data.kind,
        visibility: data.visibility ?? "summary",
        sourceTaskId: data.sourceTaskId ?? null,
        body: data.body,
        payloadJson: data.payloadJson ?? null,
        createdAt: new Date().toISOString(),
      };
      messages.push(message);
      return { ...message };
    },
    compactCompletedContext: (nestId: string): CompactNestContextResult => {
      let deletedDetailMessages = 0;
      let compactedContextMessages = 0;

      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.nestId !== nestId) continue;
        if (m.visibility === "detail") {
          messages.splice(i, 1);
          deletedDetailMessages++;
        } else if (
          m.kind === "user_message" ||
          m.kind === "tool_result" ||
          m.kind === "hoglet_summary" ||
          m.kind === "hoglet_message"
        ) {
          messages[i] = {
            ...m,
            body: "Earlier nest context was compacted after completion.",
            payloadJson: null,
            visibility: "summary",
          };
          compactedContextMessages++;
        }
      }

      return { deletedDetailMessages, compactedContextMessages };
    },
  };
}
