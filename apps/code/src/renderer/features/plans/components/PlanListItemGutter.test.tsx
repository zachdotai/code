import { Theme } from "@radix-ui/themes";
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    plans: {
      appendThreadMessage: { mutate: vi.fn().mockResolvedValue(undefined) },
      resolveThread: { mutate: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock("@features/sessions/service/service", () => ({
  getSessionService: () => ({
    sendPrompt: vi.fn().mockResolvedValue({ stopReason: "ok" }),
    respondToPermission: vi.fn().mockResolvedValue(undefined),
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

import { PlanListItemGutter } from "./PlanListItemGutter";

describe("PlanListItemGutter — DOM validity inside <ul>/<ol>", () => {
  it("renders as a direct <li> child of the parent <ul>, not wrapped in a <div>", () => {
    const { container } = render(
      <Theme>
        <ul>
          <PlanListItemGutter
            blockText="- First item"
            occurrence={0}
            filePath="/x/plan.md"
            taskId="task-1"
          >
            First item
          </PlanListItemGutter>
        </ul>
      </Theme>,
    );

    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    // Every direct child of the <ul> must be a <li> for valid DOM.
    const directChildren = Array.from(ul?.children ?? []);
    expect(directChildren.length).toBeGreaterThan(0);
    for (const child of directChildren) {
      expect(child.tagName.toLowerCase()).toBe("li");
    }
  });

  it("renders the inline composer as a sibling <li>, not as a <div> child of <ul>", () => {
    const { container, getByLabelText, getByPlaceholderText } = render(
      <Theme>
        <ul>
          <PlanListItemGutter
            blockText="- Anchor item"
            occurrence={0}
            filePath="/x/plan.md"
            taskId="task-1"
          >
            Anchor item
          </PlanListItemGutter>
        </ul>
      </Theme>,
    );

    act(() => {
      fireEvent.click(getByLabelText("Add a comment"));
    });

    // The composer's textarea must be inside a <li>, not a stray <div>.
    const textarea = getByPlaceholderText(/add a comment/i);
    let node: Element | null = textarea;
    let foundListItem = false;
    while (node && node !== container) {
      if (node.tagName.toLowerCase() === "li") {
        foundListItem = true;
        break;
      }
      if (node.tagName.toLowerCase() === "ul") break;
      node = node.parentElement;
    }
    expect(foundListItem).toBe(true);

    // And every direct child of <ul> must still be <li>.
    const ul = container.querySelector("ul");
    for (const child of Array.from(ul?.children ?? [])) {
      expect(child.tagName.toLowerCase()).toBe("li");
    }
  });
});
