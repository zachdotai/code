import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NestMessageRepository } from "../../db/repositories/nest-message-repository";
import { NestChatService } from "./nest-chat-service";
import type { Nest, NestMessage } from "./schemas";
import { SPEC_DRIVEN_DEVELOPMENT_METHOD } from "./spec-driven-development";

function makeNest(): Nest {
  const now = "2026-05-13T00:00:00.000Z";
  return {
    id: "nest-1",
    name: "Nest",
    goalPrompt: "Goal",
    definitionOfDone: "Done",
    mapX: 5,
    mapY: 6,
    status: "active",
    health: "ok",
    targetMetricId: null,
    loadoutJson: "{}",
    createdAt: now,
    updatedAt: now,
  };
}

function makeMessage(overrides: Partial<NestMessage> = {}): NestMessage {
  return {
    id: crypto.randomUUID(),
    nestId: "nest-1",
    kind: "audit",
    visibility: "summary",
    sourceTaskId: null,
    body: "Summary audit",
    payloadJson: null,
    createdAt: "2026-05-13T00:00:00.000Z",
    ...overrides,
  };
}

function createMockMessageRepository() {
  const messages: NestMessage[] = [];
  return {
    _messages: messages,
    listByNestId: vi.fn((nestId: string) =>
      messages.filter((message) => message.nestId === nestId),
    ),
    create: vi.fn((data) => {
      const message = makeMessage({
        ...data,
        visibility: data.visibility ?? "summary",
        sourceTaskId: data.sourceTaskId ?? null,
        payloadJson: data.payloadJson ?? null,
      });
      messages.push(message);
      return message;
    }),
  } as unknown as NestMessageRepository & {
    _messages: NestMessage[];
    listByNestId: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

describe("NestChatService", () => {
  let messageRepository: ReturnType<typeof createMockMessageRepository>;
  let service: NestChatService;

  beforeEach(() => {
    messageRepository = createMockMessageRepository();
    service = new NestChatService(messageRepository);
  });

  it("filters detail-only rows from the summary view", () => {
    messageRepository._messages.push(
      makeMessage({ body: "Summary audit" }),
      makeMessage({
        kind: "tool_result",
        visibility: "detail",
        body: "Verbose payload",
      }),
    );

    expect(
      service.list({ nestId: "nest-1" }).map((message) => message.body),
    ).toEqual(["Summary audit"]);
    expect(
      service
        .list({ nestId: "nest-1", detail: true })
        .map((message) => message.body),
    ).toEqual(["Summary audit", "Verbose payload"]);
  });

  it("records creation transcript and audit entries in order", () => {
    const nest = makeNest();

    service.recordCreationContext(nest, {
      name: nest.name,
      goalPrompt: nest.goalPrompt,
      definitionOfDone: nest.definitionOfDone,
      mapX: nest.mapX,
      mapY: nest.mapY,
      creationMode: "guided",
      creationTranscript: [
        { role: "user", content: "Improve checkout" },
        { role: "assistant", content: "Which metric should improve?" },
        { role: "user", content: "Reduce payment errors." },
      ],
    });

    const messages = service.list({ nestId: nest.id });
    expect(messages.map((message) => message.kind)).toEqual([
      "user_message",
      "audit",
    ]);
    expect(messages[0].body).toContain("Creation transcript");
    expect(messages[0].body).toContain("Operator: Improve checkout");
    expect(messages[0].body).toContain(
      "Goal draft: Which metric should improve?",
    );
    expect(messages[0].body).toContain("Accepted spec");
    expect(messages[0].body).toContain("Spec: Goal");
    expect(messages[0].body).toContain("Definition of done: Done");
    expect(messages[0].body).toContain(
      `Planning method: ${SPEC_DRIVEN_DEVELOPMENT_METHOD}`,
    );
    expect(messages[0].payloadJson).toContain('"creationMode":"guided"');
    expect(messages[0].payloadJson).toContain('"creationTranscript"');
    expect(messages[0].payloadJson).toContain(
      `"planningMethod":"${SPEC_DRIVEN_DEVELOPMENT_METHOD}"`,
    );
    expect(messages[1].body).toBe("Nest created at (5, 6).");
  });

  it("records unset definition of done for simple-form creation", () => {
    const nest = { ...makeNest(), definitionOfDone: null };

    service.recordCreationContext(nest, {
      name: nest.name,
      goalPrompt: nest.goalPrompt,
      definitionOfDone: null,
      mapX: nest.mapX,
      mapY: nest.mapY,
      creationMode: "simple",
    });

    expect(service.list({ nestId: nest.id })[0].body).toContain(
      "Definition of done: not set yet",
    );
    expect(service.list({ nestId: nest.id })[0].body).toContain(
      "Created through simple form",
    );
  });
});
