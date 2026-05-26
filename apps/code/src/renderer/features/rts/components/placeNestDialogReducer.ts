import {
  type GoalDraftTranscriptMessage,
  type GoalSpecDraft,
  goalDraftTranscriptMessage,
  goalSpecDraft,
  type ImportedSpecFile,
  MAX_GOAL_DRAFT_TRANSCRIPT,
  MAX_SPEC_FILE_BYTES,
} from "@main/services/rts/schemas";
import { z } from "zod";

export type NestCreationMode = "guided" | "simple";

/**
 * Trims a transcript to the cap the draft/create endpoints accept. The dialog
 * accumulates the full conversation, so we clamp before sending and on every
 * append to keep storage and payloads within bounds.
 */
export function clampTranscript(
  messages: GoalDraftTranscriptMessage[],
): GoalDraftTranscriptMessage[] {
  return messages.length > MAX_GOAL_DRAFT_TRANSCRIPT
    ? messages.slice(-MAX_GOAL_DRAFT_TRANSCRIPT)
    : messages;
}

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
  /** True once a spec file has been imported verbatim (skips the draft flow). */
  specImported: boolean;
  /** File name of the imported spec, for creation provenance. */
  importedFileName: string | null;
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
  | { type: "specFileImported"; result: ImportedSpecFile }
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
    specImported: false,
    importedFileName: null,
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
        specImported: action.saved.specImported ?? false,
        importedFileName: action.saved.importedFileName ?? null,
      };

    case "fieldChanged":
      return { ...state, [action.field]: action.value };

    case "toggleSimpleMode": {
      if (!state.simpleMode) {
        // Guided/import -> simple. The body carries over as a freeform prompt,
        // but it's no longer an import: drop the provenance so it can't be
        // created as "imported" without a DoD.
        const fallbackGoal = state.goalPrompt.trim();
        const seed = fallbackGoal || state.initialGoal.trim();
        return {
          ...state,
          simpleMode: true,
          goalPrompt: fallbackGoal ? state.goalPrompt : seed,
          specImported: false,
          importedFileName: null,
          error: null,
          lastDraftAttempt: null,
        };
      }

      // Simple -> guided ("switch back to goal-writing flow"). If a proposed
      // draft is still around, return to reviewing it unchanged.
      if (state.draft) {
        return {
          ...state,
          simpleMode: false,
          error: null,
          lastDraftAttempt: null,
        };
      }

      // No draft to return to: restart drafting with the current text as the
      // rough goal. This avoids leaving a populated-but-hidden guided spec
      // (name/prompt/DoD with no draft) that could be created with misleading
      // "accepted goal draft" provenance.
      return {
        ...state,
        simpleMode: false,
        initialGoal: state.goalPrompt.trim() || state.initialGoal,
        name: "",
        goalPrompt: "",
        definitionOfDone: "",
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
        transcript: clampTranscript([
          ...action.transcript,
          { role: "assistant", kind: "question", content: action.question },
        ]),
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
        transcript: clampTranscript([
          ...action.transcript,
          {
            role: "assistant",
            kind: "spec_proposal",
            content: formatDraftForTranscript(action.draft),
          },
        ]),
      };

    case "specFileImported": {
      const { result } = action;
      return {
        ...state,
        simpleMode: false,
        specImported: true,
        importedFileName: result.fileName,
        drafting: false,
        error: null,
        lastDraftAttempt: null,
        draft: null,
        transcript: [],
        name: state.name.trim() || result.suggestedName,
        goalPrompt: result.content,
        definitionOfDone: result.definitionOfDone ?? state.definitionOfDone,
      };
    }

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

/** Records import provenance so the created nest's audit trail is honest. */
export function buildImportedTranscript(input: {
  fileName: string | null;
}): GoalDraftTranscriptMessage[] {
  return [
    {
      role: "user",
      content: `Imported spec file: ${input.fileName ?? "a local spec file"}`,
    },
  ];
}

const DRAFT_STORAGE_KEY = "rts-nest-draft";

/**
 * Schema for the `nest-draft` localStorage entry. The renderer's own code
 * writes this, but we re-validate on restore so a corrupt or tampered
 * localStorage row can't slide unknown fields into reducer state.
 */
const persistedNestDraftSchema = z.object({
  initialGoal: z.string().max(8000),
  answer: z.string().max(8000),
  transcript: z
    .array(goalDraftTranscriptMessage)
    .max(MAX_GOAL_DRAFT_TRANSCRIPT),
  draft: goalSpecDraft.nullable(),
  name: z.string().max(240),
  // Imported spec files become the goalPrompt verbatim, and the definition of
  // done can be a full section parsed out of one, so both must accept up to
  // the import size cap — otherwise a file that imports fine fails to restore.
  goalPrompt: z.string().max(MAX_SPEC_FILE_BYTES),
  definitionOfDone: z.string().max(MAX_SPEC_FILE_BYTES),
  simpleMode: z.boolean(),
  specImported: z.boolean().optional(),
  importedFileName: z.string().max(1024).nullish(),
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
  specImported?: boolean;
  importedFileName?: string | null;
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
    specImported: state.specImported,
    importedFileName: state.importedFileName,
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
