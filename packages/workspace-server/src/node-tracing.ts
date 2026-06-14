import os from "node:os";
import {
  type Attributes,
  SpanStatusCode,
  type Tracer,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { OTEL_TRACE_SAMPLE_RATIO } from "@posthog/shared/constants";
import type { TRPCError } from "@trpc/server";

export interface NodeTracingOptions {
  serviceName: string;
  serviceVersion: string;
  attributes?: Attributes;
}

export interface NodeTracing {
  tracer: Tracer;
  shutdown: () => Promise<void>;
}

export function initNodeTracing(
  options: NodeTracingOptions,
): NodeTracing | null {
  const apiKey = process.env.VITE_POSTHOG_API_KEY;
  const apiHost = process.env.VITE_POSTHOG_API_HOST;

  if (!apiKey || !apiHost) {
    return null;
  }

  const url = `${apiHost}/i/v1/traces`;
  try {
    new URL(url);
  } catch {
    return null;
  }

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
      [ATTR_SERVICE_VERSION]: options.serviceVersion,
      "os.type": process.platform,
      "os.version": os.release(),
      ...options.attributes,
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(OTEL_TRACE_SAMPLE_RATIO),
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url,
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
        { scheduledDelayMillis: 2000 },
      ),
    ],
  });

  provider.register();

  return {
    tracer: provider.getTracer(options.serviceName),
    shutdown: async () => {
      await provider.forceFlush();
      await provider.shutdown();
    },
  };
}

export function traceTrpcCall<R extends { ok: boolean }>(
  tracer: Tracer | null,
  path: string,
  type: string,
  next: () => Promise<R>,
): Promise<R> {
  if (!tracer || type === "subscription") {
    return next();
  }

  return tracer.startActiveSpan(`trpc.${type} ${path}`, async (span) => {
    span.setAttribute("rpc.system", "trpc");
    span.setAttribute("rpc.method", path);
    span.setAttribute("trpc.type", type);
    try {
      const result = await next();
      const error = (result as { error?: TRPCError }).error;
      if (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
