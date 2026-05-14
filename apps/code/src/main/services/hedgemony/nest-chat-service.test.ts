import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NestMessageRepository } from "../../db/repositories/nest-message-repository";
import { NestChatService } from "./nest-chat-service";
import type { Nest, NestMessage } from "./schemas";
import { SPEC_DRIVEN_DEVELOPMENT_METHOD } from "./spec-driven-development";

function makeNest(overrides: Partial<Nest> = {}): Nest {
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
    ...overrides,
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
    compactCompletedContext: vi.fn(() => ({
      deletedDetailMessages: 2,
      compactedContextMessages: 1,
    })),
  } as unknown as NestMessageRepository & {
    _messages: NestMessage[];
    listByNestId: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    compactCompletedContext: ReturnType<typeof vi.fn>;
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
      creationBootstrap: {
        mode: "agent_bootstrap",
        repositories: ["posthog/posthog", "posthog/posthog-js"],
        primaryRepository: "posthog/posthog",
        prompt: "Inspect the repos and return a handoff packet.",
        handoffInstructions:
          "Persist the bootstrap task id and final handoff packet.",
        taskId: "task-bootstrap",
      },
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
    expect(messages[0].body).toContain("Bootstrap handoff");
    expect(messages[0].body).toContain("Bootstrap task: task-bootstrap");
    expect(messages[0].body).toContain(
      "Repositories: posthog/posthog, posthog/posthog-js",
    );
    expect(messages[0].payloadJson).toContain('"creationMode":"guided"');
    expect(messages[0].payloadJson).toContain('"creationTranscript"');
    expect(messages[0].payloadJson).toContain('"creationBootstrap"');
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

  it("records a final bootstrap handoff idempotently", () => {
    const first = service.recordBootstrapHandoff({
      nestId: "nest-1",
      taskId: "local-bootstrap:nest-1",
      repositories: ["posthog/posthog"],
      primaryRepository: "posthog/posthog",
      handoffMarkdown: "## Handoff\nUse pnpm test.",
      outputJson: { mode: "local_bootstrap" },
    });
    const second = service.recordBootstrapHandoff({
      nestId: "nest-1",
      taskId: "local-bootstrap:nest-1",
      repositories: ["posthog/posthog"],
      primaryRepository: "posthog/posthog",
      handoffMarkdown: "## Handoff\nUse pnpm test.",
      outputJson: { mode: "local_bootstrap" },
    });

    expect(second.id).toBe(first.id);
    expect(messageRepository.create).toHaveBeenCalledTimes(1);
    expect(first.kind).toBe("tool_result");
    expect(first.sourceTaskId).toBe("local-bootstrap:nest-1");
    expect(first.body).toContain("Bootstrap handoff captured");
    expect(first.body).toContain("Repositories: posthog/posthog");
    expect(first.payloadJson).toContain('"type":"bootstrap_handoff_final"');
  });

  it("compacts old context before writing the completion summary", () => {
    const nest = makeNest({ status: "dormant" });

    service.recordCompletionContext(nest, {
      id: nest.id,
      summary: "Goal is satisfied by the merged checkout PRs.",
      prUrls: ["https://github.com/posthog/posthog/pull/1"],
      taskIds: ["task-1"],
      caveats: ["Watch errors for a day."],
    });

    expect(messageRepository.compactCompletedContext).toHaveBeenCalledWith(
      nest.id,
    );
    const completion = service.list({ nestId: nest.id }).at(-1);
    expect(completion?.kind).toBe("audit");
    expect(completion?.body).toContain("Nest completed");
    expect(completion?.body).toContain(
      "Goal is satisfied by the merged checkout PRs.",
    );
    expect(completion?.body).toContain(
      "PRs: https://github.com/posthog/posthog/pull/1",
    );
    expect(completion?.body).toContain(
      "Compacted context: deleted 2 detail rows, compacted 1 context rows.",
    );
    expect(completion?.payloadJson).toContain('"type":"nest_completed"');
  });

  it("can forget completed context without deleting the nest row", () => {
    const nest = makeNest({ status: "dormant" });

    service.forgetCompletedContext(nest, {
      id: nest.id,
      reason: "Operator requested local DB cleanup.",
    });

    expect(messageRepository.compactCompletedContext).toHaveBeenCalledWith(
      nest.id,
    );
    const forget = service.list({ nestId: nest.id }).at(-1);
    expect(forget?.kind).toBe("audit");
    expect(forget?.body).toContain("Completed nest context forgotten");
    expect(forget?.body).toContain("Operator requested local DB cleanup.");
    expect(forget?.payloadJson).toContain(
      '"type":"completed_context_forgotten"',
    );
  });
});
