import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  buildEditDiffUpdate,
  buildHarnessModelSurface,
  reconstructEditOldText,
} from "./acp";

function fakeModel(id: string, name: string): Model<Api> {
  return { id, name, provider: "posthog" } as Model<Api>;
}

describe("reconstructEditOldText", () => {
  it("reverses a single unambiguous edit against the post-edit content", () => {
    const postEdit = "line1\nHELLO WORLD\nline3\n";
    const result = reconstructEditOldText(postEdit, [
      { oldText: "hello world", newText: "HELLO WORLD" },
    ]);
    expect(result).toBe("line1\nhello world\nline3\n");
  });

  it("returns undefined for multi-edit calls (can't safely reverse without pi's resolved offsets)", () => {
    const postEdit = "AAA\nBBB\n";
    const result = reconstructEditOldText(postEdit, [
      { oldText: "aaa", newText: "AAA" },
      { oldText: "bbb", newText: "BBB" },
    ]);
    expect(result).toBeUndefined();
  });

  it("returns undefined when newText doesn't appear in the post-edit content", () => {
    const result = reconstructEditOldText("unrelated content", [
      { oldText: "old", newText: "new" },
    ]);
    expect(result).toBeUndefined();
  });

  it("returns undefined when newText is ambiguous (appears more than once)", () => {
    const postEdit = "dup\ndup\n";
    const result = reconstructEditOldText(postEdit, [
      { oldText: "orig", newText: "dup" },
    ]);
    expect(result).toBeUndefined();
  });
});

describe("buildEditDiffUpdate", () => {
  it("builds a diff tool_call_update when reconstruction succeeds", () => {
    const update = buildEditDiffUpdate(
      "call-1",
      "/repo/file.ts",
      [{ oldText: "foo", newText: "bar" }],
      "const x = bar;",
      [],
    );
    expect(update).toEqual({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      content: [
        {
          type: "diff",
          path: "/repo/file.ts",
          oldText: "const x = foo;",
          newText: "const x = bar;",
        },
      ],
    });
  });

  it("carries the tool result's own content alongside the diff block", () => {
    const update = buildEditDiffUpdate(
      "call-1",
      "/repo/file.ts",
      [{ oldText: "foo", newText: "bar" }],
      "const x = bar;",
      [{ type: "text", text: "Edited successfully" }],
    );
    expect(update).toEqual({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      content: [
        {
          type: "diff",
          path: "/repo/file.ts",
          oldText: "const x = foo;",
          newText: "const x = bar;",
        },
        {
          type: "content",
          content: { type: "text", text: "Edited successfully" },
        },
      ],
    });
  });

  it("returns undefined when reconstruction fails", () => {
    const update = buildEditDiffUpdate(
      "call-1",
      "/repo/file.ts",
      [
        { oldText: "a", newText: "b" },
        { oldText: "c", newText: "d" },
      ],
      "irrelevant",
      [],
    );
    expect(update).toBeUndefined();
  });
});

describe("buildHarnessModelSurface", () => {
  it("strips a '(latest)' suffix, including surrounding whitespace, from model names", () => {
    const { models } = buildHarnessModelSurface(
      [fakeModel("claude-opus-4-8", "Claude Opus (latest)")],
      "claude-opus-4-8",
    );
    expect(models?.availableModels).toEqual([
      { modelId: "claude-opus-4-8", name: "Claude Opus" },
    ]);
  });

  it("prefers the '(latest)'-tagged entry when deduping same-named models", () => {
    const { models } = buildHarnessModelSurface(
      [
        fakeModel("claude-opus-4-8-old", "Claude Opus"),
        fakeModel("claude-opus-4-8", "Claude Opus (latest)"),
      ],
      "claude-opus-4-8",
    );
    expect(models?.availableModels).toEqual([
      { modelId: "claude-opus-4-8", name: "Claude Opus" },
    ]);
  });
});
