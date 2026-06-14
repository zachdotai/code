import {
  type Attributes,
  SpanStatusCode,
  type Tracer,
} from "@opentelemetry/api";

export async function withSpan<T>(
  tracer: Tracer | null,
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
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
