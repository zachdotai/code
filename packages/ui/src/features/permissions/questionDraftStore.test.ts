import { registerRendererStateStorage } from "@posthog/ui/shell/rendererStorage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQuestionDraftStore } from "./questionDraftStore";

const getItem = vi.fn();
const setItem = vi.fn();
const removeItem = vi.fn();

registerRendererStateStorage({ getItem, setItem, removeItem });

describe("feature questionDraftStore", () => {
  beforeEach(() => {
    getItem.mockReset();
    setItem.mockReset();
    removeItem.mockReset();
    getItem.mockResolvedValue(null);
    setItem.mockResolvedValue(undefined);
    removeItem.mockResolvedValue(undefined);

    useQuestionDraftStore.setState({ drafts: {} });
  });

  it("keeps drafts separate per question id", () => {
    const { setDraft, getDraft } = useQuestionDraftStore.getState().actions;

    setDraft("tool-call-a", {
      activeStep: 0,
      stepAnswers: { 0: { selectedIds: [], customInput: "answer for a" } },
    });
    setDraft("tool-call-b", {
      activeStep: 1,
      stepAnswers: { 0: { selectedIds: ["option_1"], customInput: "" } },
    });

    expect(getDraft("tool-call-a")?.stepAnswers[0]?.customInput).toBe(
      "answer for a",
    );
    expect(getDraft("tool-call-b")?.activeStep).toBe(1);
    expect(getDraft("tool-call-b")?.stepAnswers[0]?.selectedIds).toEqual([
      "option_1",
    ]);
  });

  it("returns null for an unknown question id", () => {
    expect(
      useQuestionDraftStore.getState().actions.getDraft("nope"),
    ).toBeNull();
  });

  it("clears a resolved question's draft without touching others", () => {
    const { setDraft, clearDraft, getDraft } =
      useQuestionDraftStore.getState().actions;

    setDraft("tool-call-a", {
      activeStep: 0,
      stepAnswers: { 0: { selectedIds: [], customInput: "keep" } },
    });
    setDraft("tool-call-b", {
      activeStep: 0,
      stepAnswers: { 0: { selectedIds: [], customInput: "remove" } },
    });

    clearDraft("tool-call-b");

    expect(getDraft("tool-call-b")).toBeNull();
    expect(getDraft("tool-call-a")?.stepAnswers[0]?.customInput).toBe("keep");
  });

  it("persists drafts to the storage backend", async () => {
    useQuestionDraftStore.getState().actions.setDraft("tool-call-a", {
      activeStep: 0,
      stepAnswers: { 0: { selectedIds: [], customInput: "persist me" } },
    });

    await vi.waitFor(() => {
      expect(setItem).toHaveBeenCalled();
    });

    const lastCall = setItem.mock.calls[setItem.mock.calls.length - 1];
    const persisted = JSON.parse(lastCall[1]);
    expect(
      persisted.state.drafts["tool-call-a"].stepAnswers[0].customInput,
    ).toBe("persist me");
  });
});
