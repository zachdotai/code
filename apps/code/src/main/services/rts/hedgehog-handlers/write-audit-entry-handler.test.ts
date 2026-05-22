import { describe, expect, it } from "vitest";
import { makeContext, makeMockDeps, makeToolBlock } from "./test-helpers";
import { writeAuditEntryHandler } from "./write-audit-entry-handler";

describe("writeAuditEntryHandler", () => {
  it("writes a single summary audit row when no detail is provided", async () => {
    const { deps, writeNestMessage } = makeMockDeps();

    const result = await writeAuditEntryHandler.handle(
      makeContext(),
      makeToolBlock("write_audit_entry", { summary: "Looked at hoglets" }),
      deps,
    );

    expect(result.success).toBe(true);
    expect(result.scratchpadSummary).toContain("audit");
    expect(writeNestMessage).toHaveBeenCalledTimes(1);
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        kind: "audit",
        visibility: "summary",
        body: "Looked at hoglets",
        payloadJson: null,
      }),
    );
  });

  it("writes two audit rows (summary + detail) when detail is provided", async () => {
    const { deps, writeNestMessage } = makeMockDeps();

    const result = await writeAuditEntryHandler.handle(
      makeContext(),
      makeToolBlock("write_audit_entry", {
        summary: "Did the thing",
        detail: "Specifically I did X then Y",
      }),
      deps,
    );

    expect(result.success).toBe(true);
    expect(writeNestMessage).toHaveBeenCalledTimes(2);
    expect(writeNestMessage).toHaveBeenNthCalledWith(
      1,
      "nest-1",
      expect.objectContaining({
        kind: "audit",
        visibility: "summary",
        body: "Did the thing",
        payloadJson: expect.objectContaining({
          type: "audit_with_detail",
          detail: "Specifically I did X then Y",
        }),
      }),
    );
    expect(writeNestMessage).toHaveBeenNthCalledWith(
      2,
      "nest-1",
      expect.objectContaining({
        kind: "audit",
        visibility: "detail",
        body: "Specifically I did X then Y",
      }),
    );
  });

  it("rejects empty summary as a validation error", async () => {
    const { deps, writeNestMessage } = makeMockDeps();

    const result = await writeAuditEntryHandler.handle(
      makeContext(),
      makeToolBlock("write_audit_entry", { summary: "" }),
      deps,
    );

    expect(result.success).toBe(false);
    expect(result.scratchpadSummary).toContain("validation failed");
    expect(writeNestMessage).toHaveBeenCalledWith(
      "nest-1",
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          type: "tool_validation_error",
          tool: "write_audit_entry",
        }),
      }),
    );
  });
});
