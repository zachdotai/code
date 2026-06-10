import { inject, injectable } from "inversify";
import { z } from "zod";
import { RTS_LLM_GATEWAY } from "./identifiers";
import type { LlmGatewayService, LlmMessage } from "./llm-gateway";
import { logger } from "./logger";
import {
  type GoalDraftRespondInput,
  type GoalDraftResponse,
  type GoalDraftTranscriptMessage,
  type GoalSpecBootstrapContext,
  type GoalSpecDraft,
  goalDraftResponse,
  goalSpecDraftCore,
} from "./schemas";
import {
  SPEC_DRIVEN_DEVELOPMENT_METHOD,
  SPEC_DRIVEN_GOAL_DESIGN_GUIDANCE,
} from "./spec-driven-development";

const log = logger.scope("goal-spec-draft-service");

const GOAL_DRAFT_MODEL = "claude-opus-4-8";
const GOAL_DRAFT_BETAS = ["context-1m-2025-08-07"];
const GOAL_DRAFT_EFFORT = "max";
const GOAL_DRAFT_MAX_TOKENS = 128_000;
const MAX_DRAFT_QUESTION_LENGTH = 500;

const SYSTEM_PROMPT = `You help a PostHog Code operator write a Rts nest goal before the nest exists.

Return JSON only, with exactly one of these shapes:
{"kind":"ask_question","question":"One short clarifying question"}
{"kind":"propose_spec","draft":{"name":"Short nest name","summary":"What and why, not how","primaryScenario":"The main operator/user scenario","userStories":[{"priority":"P1","story":"As a ..., I want ..., so that ...","acceptanceScenarios":["Given ..., when ..., then ..."]}],"requirements":[{"id":"FR-001","text":"The system must ..."}],"keyEntities":["Entity: why it matters"],"assumptions":["Assumption or open boundary"],"successCriteria":[{"id":"SC-001","text":"Measurable completion criterion"}],"definitionOfDone":"Concrete validation evidence"}}

priority must be exactly one of: "P1", "P2", "P3". No other values (P0, P4, High, Low, etc.) are accepted.

Rules:
- This is only a bounded goal-writing draft flow. You have no tools, no worktree access, no Task, no hoglet creation, and no autonomous side effects.
- Treat this as planning mode: clarify goals, scope, assumptions, risks, and completion signals before proposing or revising the spec. Do not move into implementation.
- Planning method: ${SPEC_DRIVEN_DEVELOPMENT_METHOD}. You must apply the method directly from this prompt; there is no skill loader in this LLM-gateway flow.
- ${SPEC_DRIVEN_GOAL_DESIGN_GUIDANCE}
- Ask one concise clarifying question under ${MAX_DRAFT_QUESTION_LENGTH} characters when the transcript does not yet explain the desired outcome, useful scope/context, and how the operator will know the goal is done.
- If the operator asks you to clone, inspect, read, or explore a repo/codebase, never imply you did it and never ask the operator to report what you found. This drafting flow cannot inspect repos. Treat repo discovery as work the future nest must perform, and include it as discovery-first requirements when the desired outcome is otherwise clear.
- Prefer proposing a spec once the operator has answered at least one clarifying question or the initial prompt is already specific.
- Keep the name under 120 characters.
- Return structured spec fields. Do not return goalPrompt; the app will render the editable Markdown spec from the structured fields.
- Use requirement IDs like FR-001 and success criterion IDs like SC-001.
- Make definitionOfDone concrete enough that a later hedgehog could judge completion.`;

function buildRetryReminder(parseError: string): string {
  return `Your previous reply failed validation: ${parseError}\n\nReturn ONLY a single JSON object matching one of the two shapes from the system prompt — no prose, no Markdown, no code fences, nothing before or after the JSON. Remember: priority must be exactly "P1", "P2", or "P3".`;
}

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
    @inject(RTS_LLM_GATEWAY)
    private readonly llmGateway: LlmGatewayService,
  ) {}

  async respond(input: GoalDraftRespondInput): Promise<GoalDraftResponse> {
    const messages = this.buildMessages(input);

    const firstResponse = await this.llmGateway.prompt(messages, {
      system: SYSTEM_PROMPT,
      maxTokens: GOAL_DRAFT_MAX_TOKENS,
      model: GOAL_DRAFT_MODEL,
      betas: GOAL_DRAFT_BETAS,
      effort: GOAL_DRAFT_EFFORT,
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
          {
            role: "user",
            content: buildRetryReminder(firstAttempt.error.message),
          },
        ],
        {
          system: SYSTEM_PROMPT,
          maxTokens: GOAL_DRAFT_MAX_TOKENS,
          model: GOAL_DRAFT_MODEL,
          betas: GOAL_DRAFT_BETAS,
          effort: GOAL_DRAFT_EFFORT,
        },
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

    const responseDraft = this.shouldReplaceRepoExplorationLoop(input, parsed)
      ? buildRepoDiscoveryFirstDraft(input.transcript)
      : parsed;
    const enrichedDraft = attachBootstrapContextIfNeeded(
      input.transcript,
      responseDraft,
    );
    const normalized = goalDraftResponse.parse(enrichedDraft);

    if (
      normalized.kind === "propose_spec" &&
      !transcriptRequestsRepoExploration(input.transcript) &&
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

  private buildMessages(input: GoalDraftRespondInput): LlmMessage[] {
    const transcript = input.transcript.slice(-12);
    const messages = transcript.map(({ role, content }) => ({
      role,
      content,
    }));
    const framing = this.buildConversationFraming(input);

    if (messages.length === 0) {
      return [{ role: "user", content: framing }];
    }

    if (messages[0].role === "user") {
      messages[0] = {
        ...messages[0],
        content: `${framing}\n\nOperator message:\n${messages[0].content}`,
      };
    } else {
      messages.unshift({ role: "user", content: framing });
    }

    if (input.currentDraft) {
      appendToLatestUserMessage(
        messages,
        `\n\nCurrent editable draft:\n${formatDraft(input.currentDraft)}`,
      );
    }

    return messages;
  }

  private buildConversationFraming(input: GoalDraftRespondInput): string {
    const mapContext =
      input.mapContext?.mapX !== undefined &&
      input.mapContext?.mapY !== undefined
        ? `\n\nMap placement: (${input.mapContext.mapX}, ${input.mapContext.mapY})`
        : "";
    const repoToolBoundary = transcriptRequestsRepoExploration(input.transcript)
      ? `\n\nRepository/tool boundary:
- The operator asked for repo/codebase exploration.
- You cannot inspect, clone, or read repositories in this draft flow.
- Do not say you reviewed the repo.
- Do not ask the operator to describe repo findings, architecture, dependencies, or constraints.
- If the desired outcome is clear, propose a spec that makes repo discovery the first requirement and records unknown repo details as assumptions/open questions.`
      : "";

    return `Draft a Rts nest goal from this creation transcript.

Return structured spec fields. The app will render goalPrompt from those fields as an editable Markdown feature specification with:
- summary and primary scenario
- prioritized user stories with acceptance scenarios
- functional requirements
- key entities
- assumptions or open questions
- measurable success criteria

The following messages are the live conversation. Keep continuity with the operator's prior answers and your own clarifying questions.${mapContext}${repoToolBoundary}`;
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

  private shouldReplaceRepoExplorationLoop(
    input: GoalDraftRespondInput,
    response: GoalDraftResponse,
  ): boolean {
    if (response.kind !== "ask_question") {
      return false;
    }

    if (!transcriptRequestsRepoExploration(input.transcript)) {
      return false;
    }

    const lastUserMessage = [...input.transcript]
      .reverse()
      .find((message) => message.role === "user");
    if (
      lastUserMessage &&
      asksAssistantToExploreRepo(lastUserMessage.content)
    ) {
      return true;
    }

    return asksForRepoFindings(response.question);
  }
}

type ParseResult =
  | { ok: true; value: GoalDraftResponse }
  | { ok: false; error: Error };

function appendToLatestUserMessage(
  messages: LlmMessage[],
  appendix: string,
): void {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      messages[index] = {
        ...messages[index],
        content: `${messages[index].content}${appendix}`,
      };
      return;
    }
  }

  messages.push({ role: "user", content: appendix.trimStart() });
}

function clampDraftArrays(obj: Record<string, unknown>): void {
  const limits: Record<string, number> = {
    userStories: 6,
    requirements: 8,
    keyEntities: 6,
    assumptions: 6,
    successCriteria: 6,
  };
  for (const [key, max] of Object.entries(limits)) {
    const value = obj[key];
    if (Array.isArray(value) && value.length > max) {
      obj[key] = value.slice(0, max);
    }
  }
}

const VALID_PRIORITIES = new Set(["P1", "P2", "P3"]);

function normalizeDraftFields(draft: Record<string, unknown>): void {
  const stories = draft.userStories;
  if (!Array.isArray(stories)) return;
  for (const story of stories) {
    if (typeof story !== "object" || story === null) continue;
    const s = story as Record<string, unknown>;
    if (typeof s.priority === "string" && !VALID_PRIORITIES.has(s.priority)) {
      const upper = s.priority.toUpperCase().trim();
      if (upper === "P0" || upper === "CRITICAL" || upper === "HIGH") {
        s.priority = "P1";
      } else if (upper === "MEDIUM" || upper === "NORMAL") {
        s.priority = "P2";
      } else if (upper === "P4" || upper === "P5" || upper === "LOW") {
        s.priority = "P3";
      } else {
        s.priority = "P2";
      }
    }
  }
}

function tryParseResponse(content: string): ParseResult {
  try {
    const raw = extractJsonObject(content);
    const json = JSON.parse(raw) as Record<string, unknown>;
    if (
      json.kind === "propose_spec" &&
      typeof json.draft === "object" &&
      json.draft !== null
    ) {
      const draftObj = json.draft as Record<string, unknown>;
      clampDraftArrays(draftObj);
      normalizeDraftFields(draftObj);
    }
    const parsed = parsedGatewayResponse.parse(json);
    if (parsed.kind === "ask_question") {
      return {
        ok: true,
        value: {
          kind: "ask_question",
          question: normalizeQuestion(parsed.question),
        },
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

function normalizeQuestion(question: string): string {
  const trimmed = question.trim();
  if (trimmed.length <= MAX_DRAFT_QUESTION_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_DRAFT_QUESTION_LENGTH - 3).trimEnd()}...`;
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
      bootstrapContext: draft.bootstrapContext,
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

function transcriptRequestsRepoExploration(
  transcript: GoalDraftTranscriptMessage[],
): boolean {
  return transcript.some(
    (message) =>
      message.role === "user" && asksAssistantToExploreRepo(message.content),
  );
}

function asksAssistantToExploreRepo(content: string): boolean {
  const lower = content.toLowerCase();
  const mentionsRepo =
    /\brepo\b|\brepository\b|\bcodebase\b|[a-z0-9_.-]+\/[a-z0-9_.-]+/i.test(
      content,
    );
  const asksForExploration =
    /\bclone\b|\bexplore\b|\binspect\b|\breview\b|\bread\b|\btake a look\b|\blook at\b|\bcheck out\b/.test(
      lower,
    );

  return mentionsRepo && asksForExploration;
}

function asksForRepoFindings(question: string): boolean {
  const lower = question.toLowerCase();
  return (
    lower.includes("what did you find") ||
    lower.includes("what you found") ||
    lower.includes("repo structure") ||
    lower.includes("repository structure") ||
    lower.includes("codebase structure") ||
    lower.includes("technical constraints") ||
    lower.includes("architectural patterns") ||
    lower.includes("dependencies") ||
    lower.includes("framework") ||
    lower.includes("existing patterns")
  );
}

function buildRepoDiscoveryFirstDraft(
  transcript: GoalDraftTranscriptMessage[],
): GoalDraftResponse {
  const transcriptText = transcript
    .map((message) => message.content)
    .join("\n")
    .trim();
  const repositories = extractRepoReferences(transcriptText);
  const repoLabel = formatRepositoryList(repositories);
  const repoTail =
    repositories.length === 1
      ? (repositories[0]?.split("/").at(-1) ?? "target repo")
      : "Target repositories";

  const draft: GoalSpecDraftCore = {
    name: "Repository discovery and implementation",
    summary: `Explore ${repoLabel}, understand the existing architecture, and deliver the requested change without disrupting unrelated behavior.`,
    primaryScenario: `The hedgehog first inspects ${repoLabel} to learn how the codebase is structured, built, tested, and extended, then implements the requested outcome using those conventions.`,
    userStories: [
      {
        priority: "P1",
        story: `As an operator, I want the hedgehog to inspect ${repoLabel} before changing code so that the work follows the repo's actual architecture.`,
        acceptanceScenarios: [
          `Given ${repoLabel} is accessible, when the nest starts, then it documents the relevant architecture, dependencies, file structure, extension points, and validation commands before implementation.`,
        ],
      },
      {
        priority: "P1",
        story:
          "As an operator, I want the requested change implemented through the repo's established patterns so that the result is maintainable and easy to validate.",
        acceptanceScenarios: [
          "Given the relevant integration points have been identified, when the change is implemented, then it fits those entry points without broad unrelated rewrites.",
          "Given the repo has relevant tests or checks, when validation runs after the change, then regressions caused by the work are fixed or documented with blockers.",
        ],
      },
    ],
    requirements: [
      {
        id: "FR-001",
        text: `Inspect ${repoLabel} and summarize the relevant architecture, dependencies, integration points, data flow, and validation commands before implementation.`,
      },
      {
        id: "FR-002",
        text: "Implement the requested outcome using the repo's established framework, file structure, and naming conventions.",
      },
      {
        id: "FR-003",
        text: "Keep unrelated features, routes, workflows, and configuration unchanged except where the requested outcome requires an explicit integration.",
      },
      {
        id: "FR-004",
        text: "Run the repo's relevant validation commands and fix regressions caused by the requested change.",
      },
      {
        id: "FR-005",
        text: "Recommend repo-scoped hoglet seeds after discovery, with one or more hoglets per repository when the work naturally decomposes that way.",
      },
    ],
    keyEntities: [
      `${repoTail}: target repo set to inspect before implementation`,
      "Requested outcome: the operator's desired behavior or deliverable from the transcript",
      "Existing extension points: integration surfaces to identify during discovery",
      "Validation commands: repo-specific checks to run after implementation",
    ],
    assumptions: [
      "Goal drafting cannot inspect or clone the repo; repository discovery must happen inside the created nest before implementation.",
      "Repo access, clone permissions, dependencies, and runnable validation commands will be resolved during the nest's discovery phase.",
    ],
    successCriteria: [
      {
        id: "SC-001",
        text: "The nest records the discovered repo architecture and validation path before implementation.",
      },
      {
        id: "SC-002",
        text: "The requested change is implemented through the repo's normal extension or integration surface.",
      },
      {
        id: "SC-003",
        text: "Relevant tests, builds, or manual validation pass, or any blockers are captured with enough detail for follow-up.",
      },
    ],
    definitionOfDone: `The hedgehog has documented the discovered shape of ${repoLabel}, implemented the requested outcome using that shape, avoided unrelated regressions, and captured validation evidence from the repo's relevant checks.`,
  };

  return {
    kind: "propose_spec",
    draft: {
      ...draft,
      goalPrompt: buildGoalPrompt(draft),
      bootstrapContext: buildBootstrapContext(transcript),
    },
  };
}

function attachBootstrapContextIfNeeded(
  transcript: GoalDraftTranscriptMessage[],
  response: GoalDraftResponse,
): GoalDraftResponse {
  if (
    response.kind !== "propose_spec" ||
    !transcriptRequestsRepoExploration(transcript)
  ) {
    return response;
  }

  return {
    kind: "propose_spec",
    draft: {
      ...response.draft,
      bootstrapContext:
        response.draft.bootstrapContext ?? buildBootstrapContext(transcript),
    },
  };
}

function buildBootstrapContext(
  transcript: GoalDraftTranscriptMessage[],
): GoalSpecBootstrapContext {
  const transcriptText = transcript
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n")
    .trim();
  const repositories = extractRepoReferences(transcriptText);
  const primaryRepository = repositories[0] ?? null;
  const repoLine =
    repositories.length > 0
      ? repositories.map((repo) => `- ${repo}`).join("\n")
      : "- Infer repository names, paths, and relationships from the operator transcript.";

  return {
    mode: "agent_bootstrap",
    repositories,
    primaryRepository,
    prompt: [
      "You are preparing a local-only Rts bootstrap handoff. Your job is discovery framing and handoff, not implementation.",
      "",
      "Operator transcript:",
      transcriptText,
      "",
      "Repositories to inspect:",
      repoLine,
      "",
      "Instructions:",
      "- Work from the operator's natural language. If multiple repositories are mentioned, inspect them as a set and describe their relationships.",
      "- Use local repository context when available. If a repository is not available locally, record that as an unknown instead of pretending it was inspected.",
      "- Keep this bootstrap read-only.",
      "- Identify architecture, dependencies, frameworks, package managers, app/feature registration patterns, validation commands, and risky integration points.",
      "- Recommend 1-many hoglet seeds grouped by repository. Each seed should include repo, objective, acceptance signal, dependencies/blockers, and whether it is discovery, implementation, or validation work.",
      "- Capture unknowns and blockers explicitly instead of guessing.",
      "- Do not spawn agents or implement the feature.",
      "",
      "Return a concise handoff packet with exactly these headings:",
      "## Rts Bootstrap Context",
      "## Repositories Inspected",
      "## Commands Run",
      "## Architecture And Dependencies",
      "## Existing Patterns To Reuse",
      "## Cross-Repo Constraints",
      "## Risks And Unknowns",
      "## Recommended Spec Updates",
      "## Recommended Hoglet Seeds",
      "## Validation Plan",
    ].join("\n"),
    handoffInstructions:
      "Persist the local bootstrap handoff packet into the nest so the non-agent hedgehog can use the discovered context to create 1-many repo-scoped hoglets without depending on a live bootstrap agent.",
  };
}

function extractRepoReferences(text: string): string[] {
  const seen = new Set<string>();
  const repositories: string[] = [];

  const addRepo = (repo: string | undefined) => {
    if (!repo) return;
    const key = repo.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    repositories.push(repo);
  };

  const repoPart = "[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?";
  const ownerPart = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?";
  const githubUrlPattern = new RegExp(
    `https?://(?:www\\.)?github\\.com/(${ownerPart}/${repoPart})(?:[/?#]|$)`,
    "g",
  );
  for (const match of text.matchAll(githubUrlPattern)) {
    addRepo(match[1]);
  }

  const ownerRepoPattern = new RegExp(
    `(^|[\\s([{'"])((${ownerPart})/(${repoPart}))(?=$|[\\s)\\]}'",.:;!?])`,
    "g",
  );
  for (const match of text.matchAll(ownerRepoPattern)) {
    addRepo(match[2]);
  }

  return repositories.slice(0, 10);
}

function formatRepositoryList(repositories: string[]): string {
  if (repositories.length === 0) {
    return "the target repo set described by the operator";
  }
  if (repositories.length === 1) {
    return repositories[0] ?? "the target repository";
  }
  return repositories.join(", ");
}
