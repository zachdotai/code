import { baseComponents } from "@features/editor/components/MarkdownRenderer";
import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { remarkPlanThreads } from "../remark/remarkPlanThreads";
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

/**
 * Integration test — verifies the FULL prop flow from markdown source
 * through the remark plugin, through react-markdown's hast→React
 * conversion, into <PlanThread>'s props, and finally to the
 * activity-store lookup. Specifically asserts that the `data-block-text`
 * and `data-occurrence` attributes survive the round trip and produce
 * the same thread key the InlineComposer would have enqueued.
 */
const FILE_PATH = "/x/plan.md";

interface PlanThreadElementProps {
  "data-block-text"?: string;
  "data-occurrence"?: string | number;
  "data-messages"?: string;
  "data-resolved"?: string;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "plan-thread": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & PlanThreadElementProps,
        HTMLElement
      >;
    }
  }
}

function parseOccurrence(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function renderMarkdown(source: string) {
  const components = {
    ...baseComponents,
    "plan-thread": (props: PlanThreadElementProps) => {
      const blockText = props["data-block-text"] ?? "";
      const occurrence = parseOccurrence(props["data-occurrence"]);
      const messages = (() => {
        try {
          return JSON.parse(props["data-messages"] ?? "[]");
        } catch {
          return [];
        }
      })();
      const resolved = props["data-resolved"] === "true";
      return (
        <PlanThread
          filePath={FILE_PATH}
          taskId="task-1"
          blockText={blockText}
          occurrence={occurrence}
          messages={messages}
          resolved={resolved}
        />
      );
    },
  } as never;

  return render(
    <StrictMode>
      <Theme>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkPlanThreads]}
          components={components}
        >
          {source}
        </ReactMarkdown>
      </Theme>
    </StrictMode>,
  );
}

describe("PlanThread integration through MarkdownRenderer", () => {
  beforeEach(() => {
    usePlanAgentActivityStore.setState({ queue: [] });
  });

  it("renders activity indicator when threadKey from rendered <plan-thread> matches enqueued key", () => {
    // Mimic the InlineComposer enqueue using the anchor block's source.
    // The remark plugin uses verbatim source slice as both `data-plan-block`
    // (annotated on the anchor) and `data-block-text` (on the thread node).
    const anchorSource = "Step one.";
    const enqueuedKey = buildThreadKey({
      filePath: FILE_PATH,
      blockText: anchorSource,
      occurrence: 0,
    });
    usePlanAgentActivityStore.getState().enqueue(enqueuedKey);

    const source = ["Step one.", "", "> [H]: my comment", "", "Step two."].join(
      "\n",
    );
    renderMarkdown(source);

    expect(screen.getByText("Responding…")).toBeInTheDocument();
  });

  it("propagates occurrence index for duplicate anchor text — second instance", () => {
    const anchorSource = "Same text.";
    // The user clicked + on the SECOND occurrence.
    const enqueuedKey = buildThreadKey({
      filePath: FILE_PATH,
      blockText: anchorSource,
      occurrence: 1,
    });
    usePlanAgentActivityStore.getState().enqueue(enqueuedKey);

    const source = ["Same text.", "", "Same text.", "", "> [H]: question"].join(
      "\n",
    );
    renderMarkdown(source);

    expect(screen.getByText("Responding…")).toBeInTheDocument();
  });

  it("renders no indicator when only the first occurrence is enqueued but the thread is on the second", () => {
    const anchorSource = "Same text.";
    usePlanAgentActivityStore.getState().enqueue(
      buildThreadKey({
        filePath: FILE_PATH,
        blockText: anchorSource,
        occurrence: 0,
      }),
    );

    const source = ["Same text.", "", "Same text.", "", "> [H]: question"].join(
      "\n",
    );
    renderMarkdown(source);

    expect(screen.queryByText("Responding…")).not.toBeInTheDocument();
  });

  it("renders activity for a thread anchored to a heading", () => {
    const enqueuedKey = buildThreadKey({
      filePath: FILE_PATH,
      blockText: "## Step 1",
      occurrence: 0,
    });
    usePlanAgentActivityStore.getState().enqueue(enqueuedKey);

    const source = ["## Step 1", "", "> [H]: thoughts?"].join("\n");
    renderMarkdown(source);

    expect(screen.getByText("Responding…")).toBeInTheDocument();
  });
});
