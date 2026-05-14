import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import type { LlmGatewayService } from "../llm-gateway/service";
import { GoalSpecDraftService } from "./goal-spec-draft-service";
import { SPEC_DRIVEN_DEVELOPMENT_METHOD } from "./spec-driven-development";

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
      model: "claude-haiku-4-5",
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
        maxTokens: 1400,
        system: expect.stringContaining(SPEC_DRIVEN_DEVELOPMENT_METHOD),
      }),
    );
    expect(llmGateway.prompt.mock.calls[0][0][0].content).toContain(
      "prioritized user stories",
    );
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
      model: "claude-haiku-4-5",
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
      model: "claude-haiku-4-5",
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
        model: "claude-haiku-4-5",
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          kind: "ask_question",
          question: "Which metric should improve?",
        }),
        model: "claude-haiku-4-5",
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
    expect(retryCall[0][2].content).toContain("not valid JSON");
  });

  it("throws a friendlier error when both attempts fail to parse", async () => {
    llmGateway.prompt.mockResolvedValue({
      content: "I cannot do that",
      model: "claude-haiku-4-5",
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
