import type { HandlerResult, HedgehogToolDeps } from "./types";

export { stringifyError } from "../utils";

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

/**
 * Records an audit message about a zod validation failure on a tool call and
 * returns the canonical "validation failed" result. Used by every handler when
 * its argSchema rejects the model's input.
 */
export function recordToolValidationError(
  deps: HedgehogToolDeps,
  nestId: string,
  toolName: string,
  error: string,
): HandlerResult {
  deps.writeNestMessage(nestId, {
    kind: "audit",
    body: `Hedgehog tool ${toolName} rejected: ${error}`,
    payloadJson: { type: "tool_validation_error", tool: toolName, error },
  });
  return {
    success: false,
    scratchpadSummary: `${toolName} validation failed`,
  };
}
