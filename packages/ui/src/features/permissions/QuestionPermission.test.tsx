import type { PermissionOption } from "@agentclientprotocol/sdk";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionPermission } from "./QuestionPermission";
import { useQuestionDraftStore } from "./questionDraftStore";
import type { PermissionToolCall } from "./types";

function questionToolCall(toolCallId: string): PermissionToolCall {
  return {
    toolCallId,
    title: "Question",
    _meta: {
      codeToolKind: "question",
      questions: [
        {
          question: "What should the button say?",
          header: "Button label",
          options: [{ label: "Submit" }, { label: "Continue" }],
        },
      ],
    },
  } as unknown as PermissionToolCall;
}

const options: PermissionOption[] = [];

function renderQuestion(toolCall: PermissionToolCall) {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <Theme>
      <QuestionPermission
        key={toolCall.toolCallId}
        toolCall={toolCall}
        options={options}
        onSelect={onSelect}
        onCancel={onCancel}
      />
    </Theme>,
  );
  return { onSelect, onCancel, view };
}

describe("QuestionPermission draft persistence", () => {
  beforeEach(() => {
    useQuestionDraftStore.setState({ drafts: {} });
  });

  // Options are Submit (1), Continue (2), and the free-text "Other" row (3).
  const OTHER_KEY = "3";

  it("restores a half-typed answer after unmount and remount", async () => {
    const user = userEvent.setup();
    const toolCall = questionToolCall("q-1");

    const { view } = renderQuestion(toolCall);

    // Focus the free-text option and type an in-progress answer.
    await user.keyboard(OTHER_KEY);
    const input = await screen.findByPlaceholderText("Type your answer...");
    await user.type(input, "Buy now");

    // Simulate switching to another session (component unmounts).
    view.unmount();

    // Return to the session: a fresh mount for the same question id.
    renderQuestion(toolCall);

    const restored = await screen.findByPlaceholderText<HTMLInputElement>(
      "Type your answer...",
    );
    expect(restored.value).toBe("Buy now");
  });

  it("does not leak a draft to a different question id", async () => {
    const user = userEvent.setup();

    const { view } = renderQuestion(questionToolCall("q-1"));
    await user.keyboard(OTHER_KEY);
    await user.type(
      await screen.findByPlaceholderText("Type your answer..."),
      "for q-1",
    );
    view.unmount();

    renderQuestion(questionToolCall("q-2"));
    const input = await screen.findByPlaceholderText<HTMLInputElement>(
      "Type your answer...",
    );
    expect(input.value).toBe("");
  });

  it("clears the draft once the question is answered", async () => {
    const user = userEvent.setup();
    const toolCall = questionToolCall("q-1");

    const { onSelect } = renderQuestion(toolCall);
    await user.keyboard(OTHER_KEY);
    const input = await screen.findByPlaceholderText("Type your answer...");
    await user.type(input, "Done");
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalled();
    expect(useQuestionDraftStore.getState().actions.getDraft("q-1")).toBeNull();
  });
});
