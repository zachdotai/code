import { createElement } from "react";
import { TextInput } from "react-native";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { modelLabel } from "../composer/options";
import type { CloudPendingPermissionRequest } from "../types";
import { PlanApprovalCard } from "./PlanApprovalCard";

vi.mock("phosphor-react-native", () => ({
  ArrowsClockwise: (props: Record<string, unknown>) =>
    createElement("ArrowsClockwise", props),
  ChatCircle: (props: Record<string, unknown>) =>
    createElement("ChatCircle", props),
  CheckCircle: (props: Record<string, unknown>) =>
    createElement("CheckCircle", props),
  Robot: (props: Record<string, unknown>) => createElement("Robot", props),
}));

vi.mock("../composer/Pill", () => ({
  Pill: (props: Record<string, unknown>) => createElement("Pill", props),
}));

vi.mock("../composer/SelectSheet", () => ({
  SelectSheet: (props: Record<string, unknown>) =>
    createElement("SelectSheet", props),
}));

vi.mock("@/lib/theme", () => ({
  useThemeColors: () => ({
    gray: {
      9: "#666666",
      11: "#444444",
    },
    accent: {
      9: "#ff5500",
    },
    status: {
      success: "#00aa55",
    },
  }),
}));

vi.mock("@/features/chat", () => ({
  MarkdownText: (props: Record<string, unknown>) =>
    createElement("MarkdownText", props),
}));

function findPressableWithText(
  renderer: NonNullable<ReturnType<typeof create>>,
  label: string,
) {
  return renderer.root.find(
    (node) =>
      typeof node.props.onPress === "function" &&
      node.findAll((child) => child.props.children === label).length > 0,
  );
}

describe("PlanApprovalCard", () => {
  it("renders the plan with the markdown renderer", () => {
    const plan = "# Plan\n\n1. Inspect renderer\n2. Fix markdown output";
    let renderer: ReturnType<typeof create> | null = null;

    act(() => {
      renderer = create(
        createElement(PlanApprovalCard, {
          toolData: {
            toolCallId: "tool-plan",
            status: "pending",
          },
          permission: {
            requestId: "request-plan",
            toolCall: {
              toolCallId: "tool-plan",
              title: "Ready to code?",
              kind: "switch_mode",
              rawInput: { plan },
            },
            options: [
              {
                kind: "allow_once",
                optionId: "default",
                name: "Yes, and manually approve edits",
              },
            ],
          },
        }),
      );
    });

    if (!renderer) {
      throw new Error("Renderer not created");
    }

    expect(renderer.root.findByType("MarkdownText").props.content).toBe(plan);
  });

  it("sends the selected approval option immediately", () => {
    const onSendPermissionResponse = vi.fn();
    let renderer: ReturnType<typeof create> | null = null;

    act(() => {
      renderer = create(
        createElement(PlanApprovalCard, {
          toolData: {
            toolCallId: "tool-1",
            status: "pending",
          },
          permission: {
            requestId: "request-1",
            toolCall: {
              toolCallId: "tool-1",
              title: "Ready to code?",
              kind: "switch_mode",
            },
            options: [
              {
                kind: "allow_once",
                optionId: "default",
                name: "Yes, and manually approve edits",
              },
            ],
          },
          onSendPermissionResponse,
        }),
      );
    });

    if (!renderer) {
      throw new Error("Renderer not created");
    }

    const approveButton = findPressableWithText(
      renderer,
      "Yes, and manually approve edits",
    );

    act(() => {
      approveButton.props.onPress();
    });

    expect(onSendPermissionResponse).toHaveBeenCalledWith({
      toolCallId: "tool-1",
      optionId: "default",
      displayText: "Yes, and manually approve edits",
    });
  });

  it("collects feedback before sending the reject option", () => {
    const onSendPermissionResponse = vi.fn();
    let renderer: ReturnType<typeof create> | null = null;

    act(() => {
      renderer = create(
        createElement(PlanApprovalCard, {
          toolData: {
            toolCallId: "tool-2",
            status: "pending",
          },
          permission: {
            requestId: "request-2",
            toolCall: {
              toolCallId: "tool-2",
              title: "Ready to code?",
              kind: "switch_mode",
            },
            options: [
              {
                kind: "reject_once",
                optionId: "reject_with_feedback",
                name: "No, and tell the agent what to do differently",
                _meta: { customInput: true },
              },
            ],
          },
          onSendPermissionResponse,
        }),
      );
    });

    if (!renderer) {
      throw new Error("Renderer not created");
    }

    const feedbackOption = findPressableWithText(
      renderer,
      "No, and tell the agent what to do differently",
    );

    act(() => {
      feedbackOption.props.onPress();
    });

    const input = renderer.root.findByType(TextInput);
    act(() => {
      input.props.onChangeText("Keep the rollback plan tighter.");
    });

    const sendButton = findPressableWithText(renderer, "Send feedback");
    act(() => {
      sendButton.props.onPress();
    });

    expect(onSendPermissionResponse).toHaveBeenCalledWith({
      toolCallId: "tool-2",
      optionId: "reject_with_feedback",
      customInput: "Keep the rollback plan tighter.",
      displayText: "Keep the rollback plan tighter.",
    });
  });

  const pendingPermission: CloudPendingPermissionRequest = {
    requestId: "request-model",
    toolCall: {
      toolCallId: "tool-model",
      title: "Ready to code?",
      kind: "switch_mode",
      rawInput: { plan: "Do the thing" },
    },
    options: [{ kind: "allow_once", optionId: "default", name: "Approve" }],
  };

  it("shows the model pill and swaps the model inline before approval", () => {
    const onModelChange = vi.fn();
    let renderer: ReturnType<typeof create> | null = null;

    act(() => {
      renderer = create(
        createElement(PlanApprovalCard, {
          toolData: { toolCallId: "tool-model", status: "pending" },
          permission: pendingPermission,
          model: "claude-opus-4-8",
          onModelChange,
        }),
      );
    });

    if (!renderer) {
      throw new Error("Renderer not created");
    }

    const pill = renderer.root.findByType("Pill");
    expect(pill.props.label).toBe(modelLabel("claude-opus-4-8"));

    const sheet = renderer.root.findByType("SelectSheet");
    act(() => {
      sheet.props.onChange("claude-sonnet-5");
    });

    expect(onModelChange).toHaveBeenCalledWith("claude-sonnet-5");
  });

  it.each([
    {
      name: "when no onModelChange is provided",
      props: {
        toolData: { toolCallId: "tool-model", status: "pending" as const },
        permission: pendingPermission,
        model: "claude-opus-4-8",
      },
    },
    {
      name: "once the plan is resolved",
      props: {
        toolData: { toolCallId: "tool-model", status: "completed" as const },
        permission: pendingPermission,
        model: "claude-opus-4-8",
        onModelChange: vi.fn(),
      },
    },
  ])("hides the model control $name", ({ props }) => {
    let renderer: ReturnType<typeof create> | null = null;

    act(() => {
      renderer = create(createElement(PlanApprovalCard, props));
    });

    if (!renderer) {
      throw new Error("Renderer not created");
    }

    expect(renderer.root.findAllByType("Pill")).toHaveLength(0);
    expect(renderer.root.findAllByType("SelectSheet")).toHaveLength(0);
  });
});
