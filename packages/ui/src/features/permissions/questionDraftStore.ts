import type { StepAnswer } from "@posthog/ui/primitives/ActionSelector";
import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

// Keyed by the question's tool-call id so an in-progress answer survives
// switching to another session and back. Deliberately per-question, not
// per-session: two sessions each asking a question keep independent drafts.
type QuestionId = string;

export interface QuestionDraft {
  activeStep: number;
  // Record (not Map) so it serializes to the persisted storage backend.
  stepAnswers: Record<number, StepAnswer>;
}

interface QuestionDraftState {
  drafts: Record<QuestionId, QuestionDraft>;
}

export interface QuestionDraftActions {
  getDraft: (questionId: QuestionId) => QuestionDraft | null;
  setDraft: (questionId: QuestionId, draft: QuestionDraft) => void;
  clearDraft: (questionId: QuestionId) => void;
}

type QuestionDraftStore = QuestionDraftState & {
  actions: QuestionDraftActions;
};

export const useQuestionDraftStore = create<QuestionDraftStore>()(
  persist(
    immer((set, get) => ({
      drafts: {},

      actions: {
        getDraft: (questionId) => get().drafts[questionId] ?? null,

        setDraft: (questionId, draft) =>
          set((state) => {
            state.drafts[questionId] = draft;
          }),

        clearDraft: (questionId) =>
          set((state) => {
            delete state.drafts[questionId];
          }),
      },
    })),
    {
      name: "question-answer-drafts",
      storage: electronStorage,
      partialize: (state) => ({ drafts: state.drafts }),
    },
  ),
);
