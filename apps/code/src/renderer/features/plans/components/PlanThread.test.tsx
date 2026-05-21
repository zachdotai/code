import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildThreadKey,
  usePlanAgentActivityStore,
} from "../stores/planAgentActivityStore";
import { PlanThread } from "./PlanThread";

vi.mock("@features/sessions/service/service", () => ({
  getSessionService: () => ({ sendPrompt: vi.fn() }),
}));

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    plans: {
      appendThreadMessage: { mutate: vi.fn().mockResolvedValue(undefined) },
      resolveThread: { mutate: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock("@features/editor/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <>{content}</>,
}));

const FILE_PATH = "/x/plan.md";
const BLOCK_TEXT = "## Step 1";

function renderThread(props: {
  resolved?: boolean;
  messages?: { speaker: "H" | "A"; text: string }[];
}) {
  return render(
    <StrictMode>
      <Theme>
        <PlanThread
          filePath={FILE_PATH}
          taskId="task-1"
          blockText={BLOCK_TEXT}
          occurrence={0}
          messages={props.messages ?? [{ speaker: "H", text: "thoughts?" }]}
          resolved={props.resolved ?? false}
        />
      </Theme>
    </StrictMode>,
  );
}

describe("PlanThread activity indicator", () => {
  beforeEach(() => {
    usePlanAgentActivityStore.setState({ queue: [] });
  });

  it("renders 'Responding…' when the thread is the active enqueued key", () => {
    // Simulate: user just submitted a comment — the InlineComposer enqueues
    // the threadKey, then the file refresh causes <PlanThread> to mount.
    usePlanAgentActivityStore.getState().enqueue(
      buildThreadKey({
        filePath: FILE_PATH,
        blockText: BLOCK_TEXT,
        occurrence: 0,
      }),
    );

    renderThread({});

    // The indicator must survive StrictMode's double-mount: previous bug
    // was that the unmount cleanup ran `dequeue` on the fake unmount,
    // clearing the queue before the real mount could render.
    expect(screen.getByText("Responding…")).toBeInTheDocument();
  });

  it("renders 'Incorporating feedback…' for resolved threads when active", () => {
    usePlanAgentActivityStore.getState().enqueue(
      buildThreadKey({
        filePath: FILE_PATH,
        blockText: BLOCK_TEXT,
        occurrence: 0,
      }),
    );

    renderThread({ resolved: true });

    expect(screen.getByText("Incorporating feedback…")).toBeInTheDocument();
  });

  it("renders 'Queued behind earlier comments' when another thread is ahead", () => {
    usePlanAgentActivityStore.getState().enqueue(
      buildThreadKey({
        filePath: FILE_PATH,
        blockText: "other block",
        occurrence: 0,
      }),
    );
    usePlanAgentActivityStore.getState().enqueue(
      buildThreadKey({
        filePath: FILE_PATH,
        blockText: BLOCK_TEXT,
        occurrence: 0,
      }),
    );

    renderThread({});

    expect(
      screen.getByText("Queued behind earlier comments"),
    ).toBeInTheDocument();
  });

  it("renders no indicator when the thread isn't enqueued", () => {
    renderThread({});

    expect(screen.queryByText("Responding…")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Queued behind earlier comments"),
    ).not.toBeInTheDocument();
  });

  it("dequeues automatically when the agent reply has landed (lastSpeaker = A)", () => {
    const key = buildThreadKey({
      filePath: FILE_PATH,
      blockText: BLOCK_TEXT,
      occurrence: 0,
    });
    usePlanAgentActivityStore.getState().enqueue(key);

    renderThread({
      messages: [
        { speaker: "H", text: "thoughts?" },
        { speaker: "A", text: "agreed" },
      ],
    });

    expect(usePlanAgentActivityStore.getState().getStatus(key)).toBeNull();
    expect(screen.queryByText("Responding…")).not.toBeInTheDocument();
  });
});
