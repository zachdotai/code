import { inject, injectable } from "inversify";
import { z } from "zod";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type { LlmMessage } from "../llm-gateway/schemas";
import type { LlmGatewayService } from "../llm-gateway/service";
import {
  type GoalDraftRespondInput,
  type GoalDraftResponse,
  type GoalDraftTranscriptMessage,
  type GoalSpecDraft,
  goalDraftResponse,
  goalSpecDraftCore,
} from "./schemas";
import {
  SPEC_DRIVEN_DEVELOPMENT_METHOD,
  SPEC_DRIVEN_GOAL_DESIGN_GUIDANCE,
} from "./spec-driven-development";

const log = logger.scope("goal-spec-draft-service");

const SYSTEM_PROMPT = `You help a PostHog Code operator write a Hedgemony nest goal before the nest exists.

Return JSON only, with exactly one of these shapes:
{"kind":"ask_question","question":"One short clarifying question"}
{"kind":"propose_spec","draft":{"name":"Short nest name","summary":"What and why, not how","primaryScenario":"The main operator/user scenario","userStories":[{"priority":"P1","story":"As a ..., I want ..., so that ...","acceptanceScenarios":["Given ..., when ..., then ..."]}],"requirements":[{"id":"FR-001","text":"The system must ..."}],"keyEntities":["Entity: why it matters"],"assumptions":["Assumption or open boundary"],"successCriteria":[{"id":"SC-001","text":"Measurable completion criterion"}],"definitionOfDone":"Concrete validation evidence"}}

Rules:
- This is only a bounded goal-writing draft flow. You have no tools, no worktree access, no Task, no hoglet creation, and no autonomous side effects.
- Planning method: ${SPEC_DRIVEN_DEVELOPMENT_METHOD}. You must apply the method directly from this prompt; there is no skill loader in this LLM-gateway flow.
- ${SPEC_DRIVEN_GOAL_DESIGN_GUIDANCE}
- Ask one concise clarifying question when the transcript does not yet explain the desired outcome, useful scope/context, and how the operator will know the goal is done.
- Prefer proposing a spec once the operator has answered at least one clarifying question or the initial prompt is already specific.
- Keep the name under 120 characters.
- Return structured spec fields. Do not return goalPrompt; the app will render the editable Markdown spec from the structured fields.
- Use requirement IDs like FR-001 and success criterion IDs like SC-001.
- Make definitionOfDone concrete enough that a later hedgehog could judge completion.`;

const JSON_ONLY_REMINDER = `Your previous reply was not valid JSON. Return ONLY a single JSON object matching one of the two shapes from the system prompt — no prose, no Markdown, no code fences, nothing before or after the JSON.`;

export class GoalDraftParseError extends Error {
  constructor() {
    super(
      "The goal-drafting model returned a response we couldn't read. Please try again, or rephrase your last message.",
    );
    this.name = "GoalDraftParseError";
  }
}

const parsedGatewayResponse = z.union([
  z.object({
    kind: z.literal("ask_question"),
    question: z.string().min(1),
  }),
  z.object({
    kind: z.literal("propose_spec"),
    draft: goalSpecDraftCore,
  }),
]);

type GoalSpecDraftCore = z.infer<typeof goalSpecDraftCore>;

@injectable()
export class GoalSpecDraftService {
  constructor(
    @inject(MAIN_TOKENS.LlmGatewayService)
    private readonly llmGateway: LlmGatewayService,
  ) {}

  async respond(input: GoalDraftRespondInput): Promise<GoalDraftResponse> {
    const userPrompt = this.buildPrompt(input);
    const messages: LlmMessage[] = [{ role: "user", content: userPrompt }];

    const firstResponse = await this.llmGateway.prompt(messages, {
      system: SYSTEM_PROMPT,
      maxTokens: 1400,
    });

    const firstAttempt = tryParseResponse(firstResponse.content);
    let parsed: GoalDraftResponse;
    if (firstAttempt.ok) {
      parsed = firstAttempt.value;
    } else {
      log.warn("Goal draft response was not parseable, retrying once", {
        error: firstAttempt.error.message,
      });
      const retryResponse = await this.llmGateway.prompt(
        [
          ...messages,
          { role: "assistant", content: firstResponse.content },
          { role: "user", content: JSON_ONLY_REMINDER },
        ],
        { system: SYSTEM_PROMPT, maxTokens: 1400 },
      );
      const secondAttempt = tryParseResponse(retryResponse.content);
      if (!secondAttempt.ok) {
        log.error("Goal draft response was unparseable after retry", {
          firstError: firstAttempt.error.message,
          secondError: secondAttempt.error.message,
          firstContent: firstResponse.content,
          retryContent: retryResponse.content,
        });
        throw new GoalDraftParseError();
      }
      parsed = secondAttempt.value;
    }

    const normalized = goalDraftResponse.parse(parsed);

    if (
      normalized.kind === "propose_spec" &&
      this.needsInitialClarification(input.transcript)
    ) {
      return {
        kind: "ask_question",
        question:
          "What outcome would make this goal clearly done, and are there any scope boundaries the hedgehog should respect?",
      };
    }

    return normalized;
  }

  private buildPrompt(input: GoalDraftRespondInput): string {
    const transcript = input.transcript
      .slice(-12)
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n\n");
    const currentDraft = input.currentDraft
      ? `\n\nCurrent editable draft:\n${formatDraft(input.currentDraft)}`
      : "";
    const mapContext =
      input.mapContext?.mapX !== undefined &&
      input.mapContext?.mapY !== undefined
        ? `\n\nMap placement: (${input.mapContext.mapX}, ${input.mapContext.mapY})`
        : "";

    return `Draft a Hedgemony nest goal from this creation transcript.

Return structured spec fields. The app will render goalPrompt from those fields as an editable Markdown feature specification with:
- summary and primary scenario
- prioritized user stories with acceptance scenarios
- functional requirements
- key entities
- assumptions or open questions
- measurable success criteria

Transcript:
${transcript}${currentDraft}${mapContext}`;
  }

  private needsInitialClarification(
    transcript: GoalDraftTranscriptMessage[],
  ): boolean {
    const userMessages = transcript.filter(
      (message) => message.role === "user",
    );
    const assistantMessages = transcript.filter(
      (message) => message.role === "assistant",
    );
    if (userMessages.length !== 1 || assistantMessages.length > 0) {
      return false;
    }

    const initial = userMessages[0].content.trim();
    if (initial.length < 80) {
      return true;
    }

    const lower = initial.toLowerCase();
    const specificitySignals = [
      "definition of done",
      "done when",
      "success",
      "metric",
      "scope",
      "constraint",
      "because",
      "so that",
    ];
    return (
      specificitySignals.filter((signal) => lower.includes(signal)).length < 2
    );
  }
}

type ParseResult =
  | { ok: true; value: GoalDraftResponse }
  | { ok: false; error: Error };

function tryParseResponse(content: string): ParseResult {
  try {
    const raw = extractJsonObject(content);
    const parsed = parsedGatewayResponse.parse(JSON.parse(raw));
    if (parsed.kind === "ask_question") {
      return {
        ok: true,
        value: { kind: "ask_question", question: parsed.question.trim() },
      };
    }
    const draft = parsed.draft;
    return {
      ok: true,
      value: {
        kind: "propose_spec",
        draft: { ...draft, goalPrompt: buildGoalPrompt(draft) },
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

function extractJsonObject(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found");
  }
  return candidate.slice(start, end + 1);
}

function formatDraft(draft: GoalSpecDraft): string {
  return JSON.stringify(
    {
      name: draft.name,
      summary: draft.summary,
      primaryScenario: draft.primaryScenario,
      userStories: draft.userStories,
      requirements: draft.requirements,
      keyEntities: draft.keyEntities,
      assumptions: draft.assumptions,
      successCriteria: draft.successCriteria,
      goalPrompt: draft.goalPrompt,
      definitionOfDone: draft.definitionOfDone,
    },
    null,
    2,
  );
}

function buildGoalPrompt(draft: GoalSpecDraftCore): string {
  const userStories = draft.userStories
    .map((story) => {
      const acceptanceScenarios = story.acceptanceScenarios
        .map((scenario) => `  - Acceptance: ${scenario}`)
        .join("\n");
      return `- ${story.priority}: ${story.story}\n${acceptanceScenarios}`;
    })
    .join("\n");

  const requirements = draft.requirements
    .map((requirement) => `- ${requirement.id}: ${requirement.text}`)
    .join("\n");

  const keyEntities =
    draft.keyEntities.length > 0
      ? draft.keyEntities.map((entity) => `- ${entity}`).join("\n")
      : "- None yet.";

  const assumptions =
    draft.assumptions.length > 0
      ? draft.assumptions.map((assumption) => `- ${assumption}`).join("\n")
      : "- None yet.";

  const successCriteria = draft.successCriteria
    .map((criterion) => `- ${criterion.id}: ${criterion.text}`)
    .join("\n");

  return [
    "## Summary",
    draft.summary,
    "## Primary Scenario",
    draft.primaryScenario,
    "## User Stories",
    userStories,
    "## Functional Requirements",
    requirements,
    "## Key Entities",
    keyEntities,
    "## Assumptions",
    assumptions,
    "## Success Criteria",
    successCriteria,
  ].join("\n\n");
}
