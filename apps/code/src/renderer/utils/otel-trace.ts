import type { Span, Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { OTEL_TRACE_SAMPLE_RATIO } from "@posthog/shared/constants";
import type { AnyRouter } from "@tanstack/react-router";
import type { ProfilerOnRenderCallback } from "react";

const SLOW_COMMIT_THRESHOLD_MS = 16;

let tracerProvider: WebTracerProvider | null = null;
let tracer: Tracer | null = null;

export function initOtelTracing(): Tracer | null {
  const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
  const apiHost =
    import.meta.env.VITE_POSTHOG_API_HOST || "https://internal-c.posthog.com";

  if (!apiKey) {
    return null;
  }

  const url = `${apiHost}/i/v1/traces`;
  try {
    new URL(url);
  } catch {
    return null;
  }

  const exporter = new OTLPTraceExporter({
    url,
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  tracerProvider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "posthog-code-desktop",
      [ATTR_SERVICE_VERSION]:
        typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown",
      "service.namespace": "renderer",
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(OTEL_TRACE_SAMPLE_RATIO),
    }),
    spanProcessors: [
      new BatchSpanProcessor(exporter, { scheduledDelayMillis: 2000 }),
    ],
  });

  tracerProvider.register();

  tracer = tracerProvider.getTracer("renderer");

  observeLongTasks();
  flushOnUnload();

  return tracer;
}

export const onAppRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
) => {
  if (!tracer || actualDuration < SLOW_COMMIT_THRESHOLD_MS) {
    return;
  }

  const span = tracer.startSpan(`react.commit ${id}`);
  span.setAttribute("react.phase", phase);
  span.setAttribute("react.actual_duration_ms", actualDuration);
  span.setAttribute("react.base_duration_ms", baseDuration);
  span.end();
};

export function traceNavigations(router: AnyRouter): void {
  let navigationSpan: Span | null = null;

  router.subscribe("onBeforeNavigate", (event) => {
    if (!tracer) return;
    navigationSpan?.end();
    navigationSpan = tracer.startSpan("route.navigate");
    navigationSpan.setAttribute(
      "route.from",
      event.fromLocation?.pathname ?? "",
    );
    navigationSpan.setAttribute("route.to", event.toLocation.pathname);
  });

  router.subscribe("onResolved", () => {
    navigationSpan?.end();
    navigationSpan = null;
  });
}

function observeLongTasks(): void {
  if (typeof PerformanceObserver === "undefined") return;

  try {
    const observer = new PerformanceObserver((list) => {
      if (!tracer) return;
      for (const entry of list.getEntries()) {
        const span = tracer.startSpan("browser.longtask");
        span.setAttribute("duration_ms", entry.duration);
        span.setAttribute("longtask.name", entry.name);
        span.end();
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    // longtask is not observable in every environment; ignore.
  }
}

function flushOnUnload(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("pagehide", () => {
    void tracerProvider?.forceFlush();
  });
}
