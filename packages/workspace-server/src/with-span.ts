import { type Attributes, SpanStatusCode } from "@opentelemetry/api";
import { getWorkspaceServerTracer } from "./otel-trace";

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = getWorkspaceServerTracer();
  if (!tracer) {
    return fn();
  }

  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn();
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
