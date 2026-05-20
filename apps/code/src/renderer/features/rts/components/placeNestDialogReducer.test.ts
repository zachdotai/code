import type { GoalSpecDraft } from "@main/services/rts/schemas";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearNestDraft,
  formatDraftForTranscript,
  initialPlaceNestDialogState,
  placeNestDialogReducer,
  restoreNestDraft,
  saveNestDraft,
  suggestName,
} from "./placeNestDialogReducer";

const draft: GoalSpecDraft = {
  name: "Improve checkout",
  summary: "Lift checkout conversion by reducing friction in step two.",
  primaryScenario: "Operator wants conversion to clear 25%.",
  userStories: [
    {
      priority: "P1",
      story: "As a buyer, I want fewer fields, so that I check out faster.",
      acceptanceScenarios: ["Given X, when Y, then Z"],
    },
  ],
  requirements: [{ id: "FR-001", text: "Reduce form fields by half" }],
  keyEntities: [],
  assumptions: [],
  successCriteria: [{ id: "SC-001", text: "Conversion lifts to 25%" }],
  goalPrompt: "## Summary\n…",
  definitionOfDone: "Conversion measured across two weeks reaches 25%.",
};

describe("placeNestDialogReducer", () => {
  it("seeds defaults from the initial state factory", () => {
    const state = initialPlaceNestDialogState("guided");
    expect(state.simpleMode).toBe(false);
    expect(state.transcript).toEqual([]);
    expect(state.drafting).toBe(false);
  });

  it("starts in simple mode when requested", () => {
    expect(initialPlaceNestDialogState("simple").simpleMode).toBe(true);
  });

  it("resets state when the reset action fires", () => {
    const dirty = placeNestDialogReducer(
      initialPlaceNestDialogState("guided"),
      { type: "fieldChanged", field: "initialGoal", value: "draft" },
    );
    const reset = placeNestDialogReducer(dirty, {
      type: "reset",
      mode: "guided",
    });
    expect(reset.initialGoal).toBe("");
    expect(reset.simpleMode).toBe(false);
  });

  it("updates individual fields without disturbing siblings", () => {
    const start = initialPlaceNestDialogState("guided");
    const next = placeNestDialogReducer(start, {
      type: "fieldChanged",
      field: "name",
      value: "Demo nest",
    });
    expect(next.name).toBe("Demo nest");
    expect(next.goalPrompt).toBe(start.goalPrompt);
  });

  it("toggles into simple mode and seeds goalPrompt from initial goal", () => {
    const start = placeNestDialogReducer(
      initialPlaceNestDialogState("guided"),
      {
        type: "fieldChanged",
        field: "initialGoal",
        value: "Improve checkout",
      },
    );
    const next = placeNestDialogReducer(start, { type: "toggleSimpleMode" });
    expect(next.simpleMode).toBe(true);
    expect(next.goalPrompt).toBe("Improve checkout");
  });

  it("toggles out of simple mode and suggests a name from the goalPrompt", () => {
    const start = placeNestDialogReducer(
      initialPlaceNestDialogState("simple"),
      {
        type: "fieldChanged",
        field: "goalPrompt",
        value: "Improve checkout conversion",
      },
    );
    const next = placeNestDialogReducer(start, { type: "toggleSimpleMode" });
    expect(next.simpleMode).toBe(false);
    expect(next.name).toBe("Improve checkout conversion");
  });

  it("flips drafting on and stashes the attempt when a draft is requested", () => {
    const start = initialPlaceNestDialogState("guided");
    const next = placeNestDialogReducer(start, {
      type: "draftRequested",
      transcript: [{ role: "user", content: "hi" }],
    });
    expect(next.drafting).toBe(true);
    expect(next.error).toBeNull();
    expect(next.lastDraftAttempt?.transcript).toEqual([
      { role: "user", content: "hi" },
    ]);
  });

  it("appends the clarifying question to the transcript", () => {
    const requested = placeNestDialogReducer(
      initialPlaceNestDialogState("guided"),
      {
        type: "draftRequested",
        transcript: [{ role: "user", content: "hi" }],
      },
    );
    const next = placeNestDialogReducer(requested, {
      type: "draftQuestionReceived",
      transcript: [{ role: "user", content: "hi" }],
      question: "What does done look like?",
    });
    expect(next.drafting).toBe(false);
    expect(next.answer).toBe("");
    expect(next.lastDraftAttempt).toBeNull();
    expect(next.transcript).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        kind: "question",
        content: "What does done look like?",
      },
    ]);
  });

  it("populates spec fields and transcript when a draft is proposed", () => {
    const start = initialPlaceNestDialogState("guided");
    const next = placeNestDialogReducer(start, {
      type: "draftProposed",
      transcript: [{ role: "user", content: "hi" }],
      draft,
    });
    expect(next.draft).toEqual(draft);
    expect(next.name).toBe(draft.name);
    expect(next.goalPrompt).toBe(draft.goalPrompt);
    expect(next.definitionOfDone).toBe(draft.definitionOfDone);
    expect(next.transcript[1]).toEqual({
      role: "assistant",
      kind: "spec_proposal",
      content: formatDraftForTranscript(draft),
    });
    expect(next.transcript[1].content).toContain(
      "Proposed a spec: Improve checkout",
    );
    expect(next.transcript[1].content).not.toContain("## Summary");
  });

  it("records draft failure and lets the user retry", () => {
    const requested = placeNestDialogReducer(
      initialPlaceNestDialogState("guided"),
      {
        type: "draftRequested",
        transcript: [{ role: "user", content: "hi" }],
      },
    );
    const failed = placeNestDialogReducer(requested, {
      type: "draftFailed",
      message: "boom",
    });
    expect(failed.drafting).toBe(false);
    expect(failed.error).toBe("boom");
    expect(failed.lastDraftAttempt?.transcript).toEqual([
      { role: "user", content: "hi" },
    ]);
  });

  it("clears prior error on a fresh submit and reports submit failures", () => {
    const start = placeNestDialogReducer(
      initialPlaceNestDialogState("guided"),
      {
        type: "submitFailed",
        message: "first",
      },
    );
    expect(start.error).toBe("first");
    const submitting = placeNestDialogReducer(start, {
      type: "submitRequested",
    });
    expect(submitting.submitting).toBe(true);
    expect(submitting.error).toBeNull();
    const failed = placeNestDialogReducer(submitting, {
      type: "submitFailed",
      message: "second",
    });
    expect(failed.submitting).toBe(false);
    expect(failed.error).toBe("second");
  });

  it("truncates long goals when suggesting a name", () => {
    const long = "a".repeat(120);
    const suggested = suggestName(long);
    expect(suggested.endsWith("...")).toBe(true);
    expect(suggested.length).toBe(80);
  });

  describe("draft persistence", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("round-trips state through save and restore", () => {
      const state = placeNestDialogReducer(
        initialPlaceNestDialogState("guided"),
        {
          type: "draftProposed",
          transcript: [{ role: "user", content: "Improve checkout" }],
          draft,
        },
      );

      saveNestDraft(state);
      const restored = restoreNestDraft();
      expect(restored).not.toBeNull();
      expect(restored?.name).toBe(draft.name);
      expect(restored?.goalPrompt).toBe(draft.goalPrompt);
      expect(restored?.transcript).toHaveLength(2);
    });

    it("restores into a valid reducer state", () => {
      const state = placeNestDialogReducer(
        initialPlaceNestDialogState("guided"),
        {
          type: "draftQuestionReceived",
          transcript: [{ role: "user", content: "Build pong" }],
          question: "What platform?",
        },
      );

      saveNestDraft(state);
      const saved = restoreNestDraft()!;
      const restored = placeNestDialogReducer(
        initialPlaceNestDialogState("guided"),
        { type: "restoreDraft", saved },
      );

      expect(restored.transcript).toHaveLength(2);
      expect(restored.transcript[1].content).toBe("What platform?");
      expect(restored.drafting).toBe(false);
      expect(restored.submitting).toBe(false);
      expect(restored.error).toBeNull();
    });

    it("clears saved draft from localStorage", () => {
      const state = initialPlaceNestDialogState("guided");
      saveNestDraft({ ...state, initialGoal: "something" });
      expect(restoreNestDraft()).not.toBeNull();

      clearNestDraft();
      expect(restoreNestDraft()).toBeNull();
    });

    it("returns null when localStorage is empty", () => {
      expect(restoreNestDraft()).toBeNull();
    });
  });
});
