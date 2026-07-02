import type {
  ConversationItem,
  TurnContext,
} from "@posthog/ui/features/sessions/components/buildConversationItems";
import {
  buildThreadGroups,
  type ThreadRow,
} from "@posthog/ui/features/sessions/components/new-thread/buildThreadGroups";
import { describe, expect, it } from "vitest";

function ctx(turnComplete: boolean): TurnContext {
  return {
    toolCalls: new Map(),
    childItems: new Map(),
    turnCancelled: false,
    turnComplete,
  };
}

function automatedCheck(id: string): ConversationItem {
  return {
    type: "automated_check",
    id,
    checkKind: "pr_ci_followup",
    content: "Re-entering to address CI feedback.",
    timestamp: 1,
    iteration: 2,
    maxIterations: 3,
    prUrl: "https://github.com/PostHog/code/pull/1",
  };
}

function tool(id: string, turnContext: TurnContext): ConversationItem {
  return {
    type: "session_update",
    id,
    turnContext,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: id,
      kind: "edit",
      title: `Edit ${id}`,
      status: turnContext.turnComplete ? "completed" : "in_progress",
    },
  };
}

function prose(id: string, turnContext: TurnContext): ConversationItem {
  return {
    type: "session_update",
    id,
    turnContext,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Fixed it." },
    },
  };
}

function userMessage(id: string): ConversationItem {
  return { type: "user_message", id, content: id, timestamp: 1 };
}

function automatedRow(row: ThreadRow) {
  if (row.kind !== "automated_turn") {
    throw new Error(`expected automated_turn, got ${row.kind}`);
  }
  return row;
}

describe("buildThreadGroups — automated turns", () => {
  it("folds the whole turn (opener + tools + prose) into one row", () => {
    const c = ctx(true);
    const items = [
      automatedCheck("a1"),
      tool("t1", c),
      prose("m1", c),
      tool("t2", c),
    ];

    const g = buildThreadGroups(items, "all", {});

    expect(g.rows).toHaveLength(1);
    const row = automatedRow(g.rows[0]);
    expect(row.opener.id).toBe("a1");
    expect(row.bodyItems.map((i) => i.id)).toEqual(["t1", "m1", "t2"]);
    expect(row.turnComplete).toBe(true);
    expect(row.expanded).toBe(false); // collapsed by default
    expect(row.summary.counts.edit).toBe(2);
    expect(row.summary.counts.messages).toBe(1);
    // every folded id maps to the single row so find-in-thread still lands here
    expect(g.idToRowIndex.get("a1")).toBe(0);
    expect(g.idToRowIndex.get("t1")).toBe(0);
    expect(g.idToRowIndex.get("m1")).toBe(0);
    expect(g.idToRowIndex.get("t2")).toBe(0);
  });

  it("stops at the next turn opener and does not swallow it", () => {
    const items = [
      automatedCheck("a1"),
      tool("t1", ctx(true)),
      userMessage("u2"),
    ];

    const g = buildThreadGroups(items, "all", {});

    expect(g.rows).toHaveLength(2);
    expect(automatedRow(g.rows[0]).bodyItems.map((i) => i.id)).toEqual(["t1"]);
    expect(g.rows[1].kind).toBe("item");
    expect(g.rows[1]).toMatchObject({ id: "u2" });
  });

  it("does not swallow a following implicit turn (different context)", () => {
    // A second turn whose updates carry a *different* context object must not be
    // absorbed even though no opener item separates them.
    const items = [
      automatedCheck("a1"),
      tool("t1", ctx(true)),
      tool("t2", ctx(false)),
    ];

    const g = buildThreadGroups(items, "all", {});

    expect(automatedRow(g.rows[0]).bodyItems.map((i) => i.id)).toEqual(["t1"]);
    // t2 falls through to its own (tool) group row.
    expect(g.rows).toHaveLength(2);
    expect(g.rows[1].kind).toBe("tool_group");
  });

  it("marks a still-streaming tail turn active", () => {
    const items = [automatedCheck("a1"), tool("t1", ctx(false))];
    const row = automatedRow(buildThreadGroups(items, "all", {}).rows[0]);
    expect(row.turnComplete).toBe(false);
  });

  it("folds even before any body has streamed", () => {
    const items = [automatedCheck("a1")];
    const row = automatedRow(buildThreadGroups(items, "all", {}).rows[0]);
    expect(row.bodyItems).toEqual([]);
    expect(row.turnComplete).toBe(false);
  });

  it.each([
    { mode: "all", overrides: {}, expanded: false },
    { mode: "partial", overrides: {}, expanded: false },
    { mode: "none", overrides: {}, expanded: true },
    { mode: "all", overrides: { "auto:a1": true }, expanded: true },
    { mode: "none", overrides: { "auto:a1": false }, expanded: false },
  ] as const)(
    "resolves expanded=$expanded for mode=$mode with override",
    ({ mode, overrides, expanded }) => {
      const items = [automatedCheck("a1"), tool("t1", ctx(true))];
      const grouping = buildThreadGroups(
        items,
        mode,
        overrides as Record<string, boolean>,
      );
      expect(automatedRow(grouping.rows[0]).expanded).toBe(expanded);
    },
  );
});
