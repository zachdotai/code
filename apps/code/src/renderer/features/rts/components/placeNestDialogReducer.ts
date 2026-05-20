import {
  type GoalDraftTranscriptMessage,
  type GoalSpecDraft,
  goalDraftTranscriptMessage,
  goalSpecDraft,
} from "@main/services/rts/schemas";
import { z } from "zod";

export type NestCreationMode = "guided" | "simple";

interface DraftAttempt {
  transcript: GoalDraftTranscriptMessage[];
  currentDraft?: GoalSpecDraft;
}

export interface PlaceNestDialogState {
  initialGoal: string;
  answer: string;
  transcript: GoalDraftTranscriptMessage[];
  draft: GoalSpecDraft | null;
  name: string;
  goalPrompt: string;
  definitionOfDone: string;
  simpleMode: boolean;
  drafting: boolean;
  submitting: boolean;
  error: string | null;
  lastDraftAttempt: DraftAttempt | null;
}

type TextField =
  | "initialGoal"
  | "answer"
  | "name"
  | "goalPrompt"
  | "definitionOfDone";

export type PlaceNestDialogAction =
  | { type: "reset"; mode: NestCreationMode }
  | { type: "restoreDraft"; saved: PersistedNestDraft }
  | { type: "fieldChanged"; field: TextField; value: string }
  | { type: "toggleSimpleMode" }
  | {
      type: "draftRequested";
      transcript: GoalDraftTranscriptMessage[];
      currentDraft?: GoalSpecDraft;
    }
  | {
      type: "draftQuestionReceived";
      transcript: GoalDraftTranscriptMessage[];
      question: string;
    }
  | {
      type: "draftProposed";
      transcript: GoalDraftTranscriptMessage[];
      draft: GoalSpecDraft;
    }
  | { type: "draftFailed"; message: string }
  | { type: "submitRequested" }
  | { type: "submitFailed"; message: string };

export function initialPlaceNestDialogState(
  mode: NestCreationMode,
): PlaceNestDialogState {
  return {
    initialGoal: "",
    answer: "",
    transcript: [],
    draft: null,
    name: "",
    goalPrompt: "",
    definitionOfDone: "",
    simpleMode: mode === "simple",
    drafting: false,
    submitting: false,
    error: null,
    lastDraftAttempt: null,
  };
}

export function placeNestDialogReducer(
  state: PlaceNestDialogState,
  action: PlaceNestDialogAction,
): PlaceNestDialogState {
  switch (action.type) {
    case "reset":
      return initialPlaceNestDialogState(action.mode);

    case "restoreDraft":
      return {
        ...initialPlaceNestDialogState(
          action.saved.simpleMode ? "simple" : "guided",
        ),
        ...action.saved,
      };

    case "fieldChanged":
      return { ...state, [action.field]: action.value };

    case "toggleSimpleMode": {
      const goingToSimple = !state.simpleMode;
      const fallbackGoal = state.goalPrompt.trim();
      let name = state.name;
      let goalPrompt = state.goalPrompt;
      if (goingToSimple) {
        const seed = fallbackGoal || state.initialGoal.trim();
        if (!fallbackGoal && seed) goalPrompt = seed;
      } else if (!state.name.trim() && fallbackGoal) {
        name = suggestName(fallbackGoal);
      }
      return {
        ...state,
        simpleMode: goingToSimple,
        name,
        goalPrompt,
        error: null,
        lastDraftAttempt: null,
      };
    }

    case "draftRequested":
      return {
        ...state,
        drafting: true,
        error: null,
        lastDraftAttempt: {
          transcript: action.transcript,
          currentDraft: action.currentDraft,
        },
      };

    case "draftQuestionReceived":
      return {
        ...state,
        drafting: false,
        answer: "",
        lastDraftAttempt: null,
        transcript: [
          ...action.transcript,
          { role: "assistant", kind: "question", content: action.question },
        ],
      };

    case "draftProposed":
      return {
        ...state,
        drafting: false,
        answer: "",
        lastDraftAttempt: null,
        draft: action.draft,
        name: action.draft.name,
        goalPrompt: action.draft.goalPrompt,
        definitionOfDone: action.draft.definitionOfDone,
        transcript: [
          ...action.transcript,
          {
            role: "assistant",
            kind: "spec_proposal",
            content: formatDraftForTranscript(action.draft),
          },
        ],
      };

    case "draftFailed":
      return { ...state, drafting: false, error: action.message };

    case "submitRequested":
      return { ...state, submitting: true, error: null };

    case "submitFailed":
      return { ...state, submitting: false, error: action.message };
  }
}

export function suggestName(goal: string): string {
  const firstLine = goal.split("\n")[0].trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

export function formatDraftForTranscript(draft: GoalSpecDraft): string {
  return [
    `Proposed a spec: ${draft.name}`,
    draft.summary,
    `Definition of done: ${draft.definitionOfDone}`,
  ].join("\n");
}

export function buildSimpleTranscript(input: {
  goalPrompt: string;
}): GoalDraftTranscriptMessage[] {
  return [
    {
      role: "user",
      content: ["Created through simple form.", "", input.goalPrompt].join(
        "\n",
      ),
    },
  ];
}

const DRAFT_STORAGE_KEY = "hedgemony-nest-draft";

/**
 * Schema for the `nest-draft` localStorage entry. The renderer's own code
 * writes this, but we re-validate on restore so a corrupt or tampered
 * localStorage row can't slide unknown fields into reducer state.
 */
const persistedNestDraftSchema = z.object({
  initialGoal: z.string().max(8000),
  answer: z.string().max(8000),
  transcript: z.array(goalDraftTranscriptMessage).max(32),
  draft: goalSpecDraft.nullable(),
  name: z.string().max(240),
  goalPrompt: z.string().max(8000),
  definitionOfDone: z.string().max(8000),
  simpleMode: z.boolean(),
});

export interface PersistedNestDraft {
  initialGoal: string;
  answer: string;
  transcript: GoalDraftTranscriptMessage[];
  draft: GoalSpecDraft | null;
  name: string;
  goalPrompt: string;
  definitionOfDone: string;
  simpleMode: boolean;
}

export function saveNestDraft(state: PlaceNestDialogState): void {
  const persisted: PersistedNestDraft = {
    initialGoal: state.initialGoal,
    answer: state.answer,
    transcript: state.transcript,
    draft: state.draft,
    name: state.name,
    goalPrompt: state.goalPrompt,
    definitionOfDone: state.definitionOfDone,
    simpleMode: state.simpleMode,
  };
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(persisted));
}

export function restoreNestDraft(): PersistedNestDraft | null {
  const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    return null;
  }
  const result = persistedNestDraftSchema.safeParse(parsed);
  if (!result.success) {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    return null;
  }
  return result.data;
}

export function clearNestDraft(): void {
  localStorage.removeItem(DRAFT_STORAGE_KEY);
}
