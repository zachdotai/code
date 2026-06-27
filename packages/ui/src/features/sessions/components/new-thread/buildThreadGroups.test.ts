import type {
  ConversationItem,
  TurnContext,
} from "@posthog/ui/features/sessions/components/buildConversationItems";
import {
  buildThreadGroups,
  groupItemRendersContent,
} from "@posthog/ui/features/sessions/components/new-thread/buildThreadGroups";
import { describe, expect, it } from "vitest";

const activeContext: TurnContext = {
  toolCalls: new Map(),
  childItems: new Map(),
  turnCancelled: false,
  turnComplete: false,
};

const completeContext: TurnContext = {
  toolCalls: new Map(),
  childItems: new Map(),
  turnCancelled: false,
  turnComplete: true,
};

function thought(
  id: string,
  {
    thoughtComplete,
    text = "pondering",
  }: { thoughtComplete?: boolean; text?: string },
  turnContext: TurnContext = activeContext,
): ConversationItem {
  return {
    type: "session_update",
    id,
    turnContext,
    thoughtComplete,
    update: {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text },
    },
  };
}

function toolItem(
  id: string,
  turnContext: TurnContext = activeContext,
): ConversationItem {
  return {
    type: "session_update",
    id,
    turnContext,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: id,
      kind: "read",
      title: "Read file.ts",
      status: turnContext.turnComplete ? "completed" : "in_progress",
    },
  };
}

/** The single tool_group row's summary, or a failed assertion. */
function summaryOf(items: ConversationItem[]) {
  const { rows } = buildThreadGroups(items, "all", {});
  const group = rows.find((r) => r.kind === "tool_group");
  if (group?.kind !== "tool_group")
    throw new Error("expected a tool_group row");
  return group.summary;
}

describe("buildThreadGroups summary — thinking awareness", () => {
  it.each([
    {
      // A still-streaming thought is the only activity so far: the chip must say
      // it's thinking, not fall back to the done label.
      name: "reads a turn mid extended-thinking as live, not 'Worked'",
      items: [thought("th1", { thoughtComplete: false })],
      active: true,
      liveLabel: "Thinking…",
      hasCountableWork: false,
      doneLabel: "Worked",
    },
    {
      // Thought, then an in-flight tool call: the tool is the latest activity,
      // so its title wins over the thinking label.
      name: "keeps the tool's live label when a tool runs after thinking",
      items: [thought("th1", { thoughtComplete: true }), toolItem("t1")],
      active: true,
      liveLabel: "Read file.ts",
      hasCountableWork: true,
      doneLabel: "Read a file",
    },
    {
      // Tool finished, agent is thinking once more: countable work plus a live
      // thinking label, so the chip can read "Read a file · Thinking…".
      name: "shows thinking again when a thought trails completed tool work",
      items: [toolItem("t1"), thought("th1", { thoughtComplete: false })],
      active: true,
      liveLabel: "Thinking…",
      hasCountableWork: true,
      doneLabel: "Read a file",
    },
    {
      // A finished turn whose only activity was thinking: no live label, falls
      // back to the "Worked" done label (there is no countable tool work).
      name: "does not treat a completed thought as live work",
      items: [thought("th1", { thoughtComplete: true }, completeContext)],
      active: false,
      liveLabel: null,
      hasCountableWork: false,
      doneLabel: "Worked",
    },
  ])("$name", ({ items, active, liveLabel, hasCountableWork, doneLabel }) => {
    const summary = summaryOf(items);

    expect(summary.active).toBe(active);
    expect(summary.liveLabel).toBe(liveLabel);
    expect(summary.hasCountableWork).toBe(hasCountableWork);
    expect(summary.doneLabel).toBe(doneLabel);
  });
});

describe("groupItemRendersContent", () => {
  it.each([
    {
      name: "a completed thought with text renders",
      item: thought("th", { thoughtComplete: true, text: "reasoned" }),
      expected: true,
    },
    {
      // The bug source: blank extended-thinking streams as a text-less thought
      // chunk, which renders nothing once complete — so it must not keep the
      // chip's bordered box alive.
      name: "a completed blank thought renders nothing",
      item: thought("th", { thoughtComplete: true, text: "   " }),
      expected: false,
    },
    {
      name: "a blank thought still streaming renders (its spinner)",
      item: thought("th", { thoughtComplete: false, text: "" }),
      expected: true,
    },
    {
      name: "a tool call renders",
      item: toolItem("t1", completeContext),
      expected: true,
    },
  ])("$name", ({ item, expected }) => {
    expect(groupItemRendersContent(item)).toBe(expected);
  });
});
