import { writeAuditEntryArgs } from "../hedgehog-tools";
import type { HandlerResult, HedgehogToolHandler } from "./types";
import { recordToolValidationError, truncate } from "./utils";

export const writeAuditEntryHandler: HedgehogToolHandler = {
  name: "write_audit_entry",
  async handle(ctx, block, deps): Promise<HandlerResult> {
    const parsed = writeAuditEntryArgs.safeParse(block.input);
    if (!parsed.success) {
      return recordToolValidationError(
        deps,
        ctx.nest.id,
        "write_audit_entry",
        parsed.error.message,
      );
    }
    const { summary, detail } = parsed.data;
    deps.writeNestMessage(ctx.nest.id, {
      kind: "audit",
      body: summary,
      payloadJson: detail ? { type: "audit_with_detail", detail } : null,
      visibility: "summary",
    });
    if (detail) {
      deps.writeNestMessage(ctx.nest.id, {
        kind: "audit",
        body: detail,
        visibility: "detail",
        payloadJson: { type: "audit_detail" },
      });
    }
    return {
      success: true,
      scratchpadSummary: `audit: ${truncate(summary, 80)}`,
    };
  },
};
