import { Theme } from "@radix-ui/themes";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mutateMock, sendPromptMock } = vi.hoisted(() => ({
  mutateMock: vi.fn().mockResolvedValue(undefined),
  sendPromptMock: vi.fn(),
}));

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    plans: {
      appendThreadMessage: { mutate: mutateMock },
      resolveThread: { mutate: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock("@features/sessions/service/service", () => ({
  getSessionService: () => ({ sendPrompt: sendPromptMock }),
}));

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
