import { Theme } from "@radix-ui/themes";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mutateMock, sendPromptMock, respondToPermissionMock } = vi.hoisted(
  () => ({
    mutateMock: vi.fn().mockResolvedValue(undefined),
    sendPromptMock: vi.fn(),
    respondToPermissionMock: vi.fn().mockResolvedValue(undefined),
  }),
);

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    plans: {
      appendThreadMessage: { mutate: mutateMock },
      resolveThread: { mutate: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock("@features/sessions/service/service", () => ({
  getSessionService: () => ({
    sendPrompt: sendPromptMock,
    respondToPermission: respondToPermissionMock,
  }),
}));

vi.mock("@features/sessions/hooks/useSession", async () => {
  const actual = await vi.importActual<
    typeof import("@features/sessions/hooks/useSession")
  >("@features/sessions/hooks/useSession");
  return {
    ...actual,
    getPendingPermissionsForTask: vi.fn(() => new Map()),
  };
});

vi.mock("@features/editor/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <>{content}</>,
}));

import {
  buildThreadKey,
  usePlanAgentActivityStore,
} from "../stores/planAgentActivityStore";
import { PlanBlockGutter } from "./PlanBlockGutter";
import { PlanThread } from "./PlanThread";

const FILE = "/x/plan.md";
const BLOCK = "Step 1";

function key() {
  return buildThreadKey({
    filePath: FILE,
    blockText: BLOCK,
    occurrence: 0,
  });
}

describe("PlanBlockGutter — composer does not block on the agent turn", () => {
  beforeEach(() => {
    usePlanAgentActivityStore.setState({ queue: [] });
    mutateMock.mockClear();
    mutateMock.mockResolvedValue(undefined);
    sendPromptMock.mockReset();
  });

  it("closes the composer immediately after the plan write, without waiting for the agent's full turn", async () => {
    // Simulate a sendPrompt that hasn't resolved yet — like the agent
    // taking 30s to generate a response. The composer should close
    // immediately and the "Add a comment" trigger should be visible
    // again, without waiting for the prompt to resolve.
    let resolveSend: () => void = () => undefined;
    sendPromptMock.mockReturnValue(
      new Promise<{ stopReason: string }>((res) => {
        resolveSend = () => res({ stopReason: "ok" });
      }),
    );

    render(
      <Theme>
        <PlanBlockGutter
          blockText={BLOCK}
          occurrence={0}
          filePath={FILE}
          taskId="task-1"
        >
          <p>{BLOCK}</p>
        </PlanBlockGutter>
      </Theme>,
    );

    fireEvent.click(screen.getByLabelText("Add a comment"));
    fireEvent.change(screen.getByPlaceholderText(/add a comment/i), {
      target: { value: "Looks good" },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Add comment"));
    });

    // Composer must have closed even though sendPrompt is still pending.
    expect(screen.queryByPlaceholderText(/add a comment/i)).toBeNull();
    // And the "+" trigger should be available again to start a new
    // comment without waiting.
    expect(screen.getByLabelText("Add a comment")).toBeInTheDocument();
    // Activity should be queued — the agent is still working.
    expect(usePlanAgentActivityStore.getState().getStatus(key())).toBe(
      "active",
    );

    // Now let the prompt finally resolve — should not affect any state.
    resolveSend();
    await act(async () => undefined);
    expect(usePlanAgentActivityStore.getState().getStatus(key())).toBe(
      "active",
    );
  });
});

describe("PlanBlockGutter — sendPrompt error handling", () => {
  beforeEach(() => {
    usePlanAgentActivityStore.setState({ queue: [] });
    mutateMock.mockClear();
    mutateMock.mockResolvedValue(undefined);
    sendPromptMock.mockReset();
  });

  it("dequeues the thread when sendPrompt rejects so the indicator doesn't stick", async () => {
    sendPromptMock.mockRejectedValue(new Error("No internet connection"));

    render(
      <Theme>
        <PlanBlockGutter
          blockText={BLOCK}
          occurrence={0}
          filePath={FILE}
          taskId="task-1"
        >
          <p>{BLOCK}</p>
        </PlanBlockGutter>
      </Theme>,
    );

    // Open composer and submit a comment.
    fireEvent.click(screen.getByLabelText("Add a comment"));
    fireEvent.change(screen.getByPlaceholderText(/add a comment/i), {
      target: { value: "Looks good" },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Add comment"));
    });

    // After the failure, the enqueued activity must be cleared.
    expect(usePlanAgentActivityStore.getState().getStatus(key())).toBeNull();
  });

  it("keeps the thread enqueued when sendPrompt succeeds", async () => {
    sendPromptMock.mockResolvedValue({ stopReason: "queued" });

    render(
      <Theme>
        <PlanBlockGutter
          blockText={BLOCK}
          occurrence={0}
          filePath={FILE}
          taskId="task-1"
        >
          <p>{BLOCK}</p>
        </PlanBlockGutter>
      </Theme>,
    );

    fireEvent.click(screen.getByLabelText("Add a comment"));
    fireEvent.change(screen.getByPlaceholderText(/add a comment/i), {
      target: { value: "Looks good" },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Add comment"));
    });

    expect(usePlanAgentActivityStore.getState().getStatus(key())).toBe(
      "active",
    );
  });
});

describe("PlanThread — sendPrompt error handling", () => {
  beforeEach(() => {
    usePlanAgentActivityStore.setState({ queue: [] });
    mutateMock.mockClear();
    mutateMock.mockResolvedValue(undefined);
    sendPromptMock.mockReset();
  });

  it("dequeues when reply's sendPrompt rejects", async () => {
    sendPromptMock.mockRejectedValue(new Error("disconnected"));

    render(
      <Theme>
        <PlanThread
          filePath={FILE}
          taskId="task-1"
          blockText={BLOCK}
          occurrence={0}
          messages={[{ speaker: "H", text: "first" }]}
          resolved={false}
        />
      </Theme>,
    );

    fireEvent.click(screen.getByText("Reply"));
    fireEvent.change(screen.getByPlaceholderText(/write a reply/i), {
      target: { value: "More" },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Reply"));
    });

    expect(usePlanAgentActivityStore.getState().getStatus(key())).toBeNull();
  });

  it("dequeues when resolve's sendPrompt rejects", async () => {
    sendPromptMock.mockRejectedValue(new Error("offline"));

    render(
      <Theme>
        <PlanThread
          filePath={FILE}
          taskId="task-1"
          blockText={BLOCK}
          occurrence={0}
          messages={[{ speaker: "H", text: "first" }]}
          resolved={false}
        />
      </Theme>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Resolve"));
    });

    expect(usePlanAgentActivityStore.getState().getStatus(key())).toBeNull();
  });
});

describe("PlanBlockGutter — comment while ExitPlanMode is pending", () => {
  beforeEach(async () => {
    usePlanAgentActivityStore.setState({ queue: [] });
    mutateMock.mockClear();
    mutateMock.mockResolvedValue(undefined);
    sendPromptMock.mockReset();
    respondToPermissionMock.mockReset();
    respondToPermissionMock.mockResolvedValue(undefined);

    const useSessionMod = await import("@features/sessions/hooks/useSession");
    const fn = useSessionMod.getPendingPermissionsForTask as ReturnType<
      typeof vi.fn
    >;
    fn.mockReset();
    fn.mockReturnValue(
      new Map<string, unknown>([
        [
          "tc-plan",
          {
            taskRunId: "task-1",
            receivedAt: 0,
            options: [
              { optionId: "default", name: "Default", kind: "allow_once" },
              {
                optionId: "reject_with_feedback",
                name: "Reject",
                kind: "reject_once",
              },
            ],
            toolCall: {
              toolCallId: "tc-plan",
              kind: "switch_mode",
              title: "Switch mode",
              content: [],
              locations: [],
              rawInput: {},
            },
          },
        ],
      ]),
    );
  });

  it("rejects the pending switch_mode permission with the comment prompt instead of queueing", async () => {
    sendPromptMock.mockResolvedValue({ stopReason: "ok" });

    render(
      <Theme>
        <PlanBlockGutter
          blockText={BLOCK}
          occurrence={0}
          filePath={FILE}
          taskId="task-1"
        >
          <p>{BLOCK}</p>
        </PlanBlockGutter>
      </Theme>,
    );

    fireEvent.click(screen.getByLabelText("Add a comment"));
    fireEvent.change(screen.getByPlaceholderText(/add a comment/i), {
      target: { value: "Add more detail" },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Add comment"));
    });

    expect(respondToPermissionMock).toHaveBeenCalledTimes(1);
    const [taskIdArg, toolCallIdArg, optionIdArg, customInputArg] =
      respondToPermissionMock.mock.calls[0];
    expect(taskIdArg).toBe("task-1");
    expect(toolCallIdArg).toBe("tc-plan");
    expect(optionIdArg).toBe("reject_with_feedback");
    expect(typeof customInputArg).toBe("string");
    expect(customInputArg).toMatch(/plan/i);
    expect(sendPromptMock).not.toHaveBeenCalled();

    // Activity indicator should remain "active" — the dispatch
    // succeeded (via rejection feedback) and we expect the agent to
    // respond.
    expect(usePlanAgentActivityStore.getState().getStatus(key())).toBe(
      "active",
    );
  });
});
