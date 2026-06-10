import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./logger", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { GoalSpecDraftService } from "./goal-spec-draft-service";
import type { LlmGatewayService } from "./llm-gateway";
import { SPEC_DRIVEN_DEVELOPMENT_METHOD } from "./spec-driven-development";

const GOAL_DRAFT_MODEL = "claude-opus-4-8";
const GOAL_DRAFT_BETAS = ["context-1m-2025-08-07"];
const GOAL_DRAFT_EFFORT = "max";
const GOAL_DRAFT_MAX_TOKENS = 128_000;

function createMockLlmGateway() {
  return {
    prompt: vi.fn(),
  } as unknown as LlmGatewayService & {
    prompt: ReturnType<typeof vi.fn>;
  };
}

describe("GoalSpecDraftService", () => {
  let llmGateway: ReturnType<typeof createMockLlmGateway>;
  let service: GoalSpecDraftService;

  beforeEach(() => {
    llmGateway = createMockLlmGateway();
    service = new GoalSpecDraftService(llmGateway);
  });

  it("returns the next clarifying question from the gateway", async () => {
    llmGateway.prompt.mockResolvedValue({
      content: JSON.stringify({
        kind: "ask_question",
        question: "Which metric should improve?",
      }),
      model: GOAL_DRAFT_MODEL,
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    await expect(
      service.respond({
        transcript: [{ role: "user", content: "Improve checkout" }],
        mapContext: { mapX: 10, mapY: 20 },
      }),
    ).resolves.toEqual({
      kind: "ask_question",
      question: "Which metric should improve?",
    });

    expect(llmGateway.prompt).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("Map placement: (10, 20)"),
        }),
      ],
      expect.objectContaining({
        maxTokens: GOAL_DRAFT_MAX_TOKENS,
        model: GOAL_DRAFT_MODEL,
        betas: GOAL_DRAFT_BETAS,
        effort: GOAL_DRAFT_EFFORT,
        system: expect.stringContaining(SPEC_DRIVEN_DEVELOPMENT_METHOD),
      }),
    );
    expect(llmGateway.prompt.mock.calls[0][0][0].content).toContain(
      "prioritized user stories",
    );
    expect(llmGateway.prompt.mock.calls[0][1].system).toContain(
      "Treat this as planning mode",
    );
  });

  it("keeps clarifying questions inside the renderer schema limit", async () => {
    const longQuestion = `Which parts of this workflow should the hedgehog treat as in scope, what should stay out of scope, what validation evidence would make the goal clearly done, which repositories should be inspected first, what existing behavior must remain unchanged, and are there any operator preferences around implementation approach, release shape, testing commands, or follow-up handoff notes that should be captured before the nest starts planning the actual implementation work? ${"x".repeat(200)}`;

    llmGateway.prompt.mockResolvedValue({
      content: JSON.stringify({
        kind: "ask_question",
        question: longQuestion,
      }),
      model: GOAL_DRAFT_MODEL,
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const response = await service.respond({
      transcript: [
        {
          role: "user",
          content:
            "Improve checkout conversion with clear scope boundaries, success evidence, and validation steps.",
        },
      ],
    });

    expect(response.kind).toBe("ask_question");
    if (response.kind === "ask_question") {
      expect(response.question).toHaveLength(500);
      expect(response.question.endsWith("...")).toBe(true);
    }
  });

  it("clamps oversized arrays instead of failing to parse", async () => {
    const oversizedDraft = {
      kind: "propose_spec",
      draft: {
        name: "Pong game",
        summary: "Add a pong game.",
        primaryScenario: "Player launches pong from game menu.",
        userStories: [
          {
            priority: "P1",
            story: "As a player, I want to play pong.",
            acceptanceScenarios: ["Given menu, when select, then pong loads."],
          },
        ],
        requirements: Array.from({ length: 12 }, (_, i) => ({
          id: `FR-${String(i + 1).padStart(3, "0")}`,
          text: `Requirement ${i + 1}`,
        })),
        keyEntities: [],
        assumptions: [],
        successCriteria: Array.from({ length: 10 }, (_, i) => ({
          id: `SC-${String(i + 1).padStart(3, "0")}`,
          text: `Criterion ${i + 1}`,
        })),
        definitionOfDone: "Pong is playable.",
      },
    };

    llmGateway.prompt.mockResolvedValue({
      content: JSON.stringify(oversizedDraft),
      model: GOAL_DRAFT_MODEL,
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const response = await service.respond({
      transcript: [
        { role: "user", content: "Add a pong game to the repo." },
        { role: "assistant", content: "What style do you want?" },
        { role: "user", content: "Retro arcade, three difficulty levels." },
      ],
    });

    expect(response.kind).toBe("propose_spec");
    if (response.kind === "propose_spec") {
      expect(response.draft.successCriteria).toHaveLength(6);
      expect(response.draft.requirements).toHaveLength(8);
    }
  });

  it("returns an editable draft spec when enough context exists", async () => {
    llmGateway.prompt.mockResolvedValue({
      content: `Here you go:\n\n\`\`\`json\n${JSON.stringify({
        kind: "propose_spec",
        draft: {
          name: "Checkout lift",
          summary:
            "Reduce checkout payment errors so more customers complete purchase.",
          primaryScenario:
            "A customer reaches payment, enters valid details, and either completes checkout or receives an actionable error.",
          userStories: [
            {
              priority: "P1",
              story:
                "As an operator, I want payment-error causes surfaced so that we can remove the largest checkout blockers.",
              acceptanceScenarios: [
                "Given checkout events are available, when the hedgehog analyzes failures, then it identifies the top payment-error causes.",
              ],
            },
          ],
          requirements: [
            {
              id: "FR-001",
              text: "The nest must identify and prioritize payment-error causes.",
            },
          ],
          keyEntities: ["Checkout session: the customer attempt to pay"],
          assumptions: ["Existing checkout analytics are available."],
          successCriteria: [
            {
              id: "SC-001",
              text: "Payment-error rate is lower on the validation dashboard.",
            },
          ],
          definitionOfDone:
            "Payment-error rate is lower and the checkout runbook is updated.",
        },
      })}\n\`\`\``,
      model: GOAL_DRAFT_MODEL,
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const response = await service.respond({
      transcript: [
        { role: "user", content: "Improve checkout" },
        {
          role: "assistant",
          content: "Which metric should improve?",
        },
        {
          role: "user",
          content:
            "Reduce payment errors and update the runbook once dashboards prove the rate fell.",
        },
      ],
    });

    expect(response).toEqual({
      kind: "propose_spec",
      draft: expect.objectContaining({
        name: "Checkout lift",
        summary:
          "Reduce checkout payment errors so more customers complete purchase.",
        definitionOfDone:
          "Payment-error rate is lower and the checkout runbook is updated.",
      }),
    });
    expect(response.kind).toBe("propose_spec");
    if (response.kind === "propose_spec") {
      expect(response.draft.goalPrompt).toContain("## User Stories");
      expect(response.draft.goalPrompt).toContain(
        "FR-001: The nest must identify",
      );
      expect(response.draft.goalPrompt).toContain(
        "SC-001: Payment-error rate is lower",
      );
    }

    const messages = llmGateway.prompt.mock.calls[0][0];
    expect(messages).toMatchObject([
      {
        role: "user",
        content: expect.stringContaining("Operator message:\nImprove checkout"),
      },
      { role: "assistant", content: "Which metric should improve?" },
      {
        role: "user",
        content: expect.stringContaining("Reduce payment errors"),
      },
    ]);
    expect(messages[0].content).toContain("Return structured spec fields");
    expect(messages[0].content).not.toContain("ASSISTANT:");
  });

  it("sends the current editable draft with the latest user turn", async () => {
    llmGateway.prompt.mockResolvedValue({
      content: JSON.stringify({
        kind: "ask_question",
        question: "Should the edited runbook requirement stay in scope?",
      }),
      model: GOAL_DRAFT_MODEL,
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    await service.respond({
      transcript: [
        { role: "user", content: "Improve checkout" },
        {
          role: "assistant",
          kind: "spec_proposal",
          content: "Proposed a spec: Checkout lift",
        },
        {
          role: "user",
          content: "Keep the runbook update in the plan.",
        },
      ],
      currentDraft: {
        name: "Checkout lift",
        summary:
          "Reduce checkout payment errors so more customers complete purchase.",
        primaryScenario:
          "A customer reaches payment and gets through checkout cleanly.",
        userStories: [
          {
            priority: "P1",
            story:
              "As an operator, I want payment-error causes surfaced so that we can remove checkout blockers.",
            acceptanceScenarios: [
              "Given checkout events are available, when failures are analyzed, then the top causes are named.",
            ],
          },
        ],
        requirements: [
          {
            id: "FR-001",
            text: "The nest must keep the runbook update in scope.",
          },
        ],
        keyEntities: ["Checkout session: the customer attempt to pay"],
        assumptions: ["Existing checkout analytics are available."],
        successCriteria: [
          {
            id: "SC-001",
            text: "Payment-error rate is lower on the validation dashboard.",
          },
        ],
        goalPrompt: "## Summary\nEdited checkout markdown",
        definitionOfDone:
          "Payment-error rate is lower and the checkout runbook is updated.",
      },
    });

    const messages = llmGateway.prompt.mock.calls[0][0];
    expect(messages).toHaveLength(3);
    expect(messages[2]).toMatchObject({
      role: "user",
      content: expect.stringContaining("Current editable draft:"),
    });
    expect(messages[2].content).toContain("Edited checkout markdown");
    expect(messages[1].content).not.toContain("Current editable draft:");
  });

  it("forces one clarification for an under-specified initial prompt", async () => {
    llmGateway.prompt.mockResolvedValue({
      content: JSON.stringify({
        kind: "propose_spec",
        draft: {
          name: "Checkout",
          summary: "Improve checkout.",
          primaryScenario: "A customer attempts checkout.",
          userStories: [
            {
              priority: "P1",
              story: "As an operator, I want checkout improved.",
              acceptanceScenarios: [
                "Given checkout, when changed, then better.",
              ],
            },
          ],
          requirements: [{ id: "FR-001", text: "Improve checkout." }],
          keyEntities: [],
          assumptions: [],
          successCriteria: [{ id: "SC-001", text: "Checkout is better." }],
          definitionOfDone: "Checkout is better.",
        },
      }),
      model: GOAL_DRAFT_MODEL,
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const response = await service.respond({
      transcript: [{ role: "user", content: "Improve checkout" }],
    });

    expect(response).toEqual({
      kind: "ask_question",
      question:
        "What outcome would make this goal clearly done, and are there any scope boundaries the hedgehog should respect?",
    });
    expect(llmGateway.prompt).toHaveBeenCalledTimes(1);
  });

  it("retries once and recovers when the first response is not valid JSON", async () => {
    llmGateway.prompt
      .mockResolvedValueOnce({
        content: "Sure — here you go!",
        model: GOAL_DRAFT_MODEL,
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          kind: "ask_question",
          question: "Which metric should improve?",
        }),
        model: GOAL_DRAFT_MODEL,
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      });

    await expect(
      service.respond({
        transcript: [{ role: "user", content: "Improve checkout" }],
      }),
    ).resolves.toEqual({
      kind: "ask_question",
      question: "Which metric should improve?",
    });

    expect(llmGateway.prompt).toHaveBeenCalledTimes(2);
    const retryCall = llmGateway.prompt.mock.calls[1];
    expect(retryCall[0]).toHaveLength(3);
    expect(retryCall[0][1]).toEqual({
      role: "assistant",
      content: "Sure — here you go!",
    });
    expect(retryCall[0][2].role).toBe("user");
    expect(retryCall[0][2].content).toContain("failed validation");
    expect(retryCall[1]).toMatchObject({
      maxTokens: GOAL_DRAFT_MAX_TOKENS,
      model: GOAL_DRAFT_MODEL,
      betas: GOAL_DRAFT_BETAS,
      effort: GOAL_DRAFT_EFFORT,
    });
  });

  it("turns repo exploration requests into discovery-first specs instead of looping questions back", async () => {
    llmGateway.prompt.mockResolvedValue({
      content: JSON.stringify({
        kind: "ask_question",
        question:
          "Based on the repo structure you reviewed, what are the key technical constraints or dependencies we need to work around?",
      }),
      model: GOAL_DRAFT_MODEL,
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const response = await service.respond({
      transcript: [
        {
          role: "user",
          content:
            "Working on repo Brooker-Fam/nexus-game and Brooker-Fam/nexus-ui and we want to add a new pong game without breaking any of the existing games.",
        },
        {
          role: "assistant",
          content:
            "What does 'add a new pong game' entail—is it a new game mode or a separate entry?",
        },
        {
          role: "user",
          content:
            "It's completely new. Can you clone the repo and take a look at it to understand its shape and dependencies?",
        },
        {
          role: "assistant",
          content:
            "After reviewing the repo structure, what are the key technical constraints?",
        },
        {
          role: "user",
          content: "I want YOU to explore the repo",
        },
      ],
    });

    expect(response.kind).toBe("propose_spec");
    if (response.kind === "propose_spec") {
      expect(response.draft.name).toBe(
        "Repository discovery and implementation",
      );
      expect(response.draft.summary).toContain("Brooker-Fam/nexus-game");
      expect(response.draft.summary).toContain("Brooker-Fam/nexus-ui");
      expect(response.draft.requirements[0].text).toContain(
        "Inspect Brooker-Fam/nexus-game, Brooker-Fam/nexus-ui",
      );
      expect(response.draft.bootstrapContext).toMatchObject({
        mode: "agent_bootstrap",
        repositories: ["Brooker-Fam/nexus-game", "Brooker-Fam/nexus-ui"],
        primaryRepository: "Brooker-Fam/nexus-game",
      });
      expect(response.draft.bootstrapContext?.prompt).toContain(
        "inspect them as a set",
      );
      expect(response.draft.bootstrapContext?.prompt).toContain(
        "Recommend 1-many hoglet seeds grouped by repository",
      );
      expect(response.draft.bootstrapContext?.prompt).toContain(
        "## Recommended Hoglet Seeds",
      );
      expect(response.draft.bootstrapContext?.handoffInstructions).toContain(
        "create 1-many repo-scoped hoglets",
      );
      expect(response.draft.assumptions[0]).toContain(
        "Goal drafting cannot inspect or clone the repo",
      );
      expect(response.draft.goalPrompt).toContain("## Functional Requirements");
    }

    expect(llmGateway.prompt.mock.calls[0][0][0].content).toContain(
      "Do not ask the operator to describe repo findings",
    );
  });

  it("throws a friendlier error when both attempts fail to parse", async () => {
    llmGateway.prompt.mockResolvedValue({
      content: "I cannot do that",
      model: GOAL_DRAFT_MODEL,
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    await expect(
      service.respond({
        transcript: [{ role: "user", content: "Improve checkout" }],
      }),
    ).rejects.toThrow(
      "The goal-drafting model returned a response we couldn't read.",
    );
    expect(llmGateway.prompt).toHaveBeenCalledTimes(2);
  });
});
