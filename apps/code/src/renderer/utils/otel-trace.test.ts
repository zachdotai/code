import { beforeEach, describe, expect, it, vi } from "vitest";

const span = { setAttribute: vi.fn(), end: vi.fn() };
const mockStartSpan = vi.fn(() => span);
const mockRegister = vi.fn();

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class {
    constructor(public config: unknown) {}
  },
}));

vi.mock("@opentelemetry/sdk-trace-base", () => ({
  BatchSpanProcessor: class {
    constructor(
      public _e: unknown,
      public _o: unknown,
    ) {}
  },
  ParentBasedSampler: class {
    constructor(public _o: unknown) {}
  },
  TraceIdRatioBasedSampler: class {
    constructor(public _r: number) {}
  },
}));

vi.mock("@opentelemetry/sdk-trace-web", () => ({
  WebTracerProvider: class {
    constructor(public _o: unknown) {}
    register() {
      return mockRegister();
    }
    getTracer() {
      return { startSpan: mockStartSpan };
    }
    forceFlush() {
      return Promise.resolve();
    }
  },
}));

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: vi.fn((a: Record<string, string>) => a),
}));

vi.mock("@opentelemetry/semantic-conventions", () => ({
  ATTR_SERVICE_NAME: "service.name",
  ATTR_SERVICE_VERSION: "service.version",
}));

vi.mock("@renderer/utils/logger", () => ({
  logger: { scope: () => ({ info: vi.fn() }) },
}));

describe("renderer otel-trace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  describe("initOtelTracing gating", () => {
    it.each([
      ["key missing", "", "https://test.posthog.com"],
      ["host missing", "phc_test", ""],
      ["non-https host", "phc_test", "http://evil.example.com"],
    ])("returns null when %s", async (_c, key, host) => {
      vi.stubEnv("VITE_POSTHOG_API_KEY", key);
      vi.stubEnv("VITE_POSTHOG_API_HOST", host);
      const { initOtelTracing } = await import("@renderer/utils/otel-trace");
      expect(initOtelTracing()).toBeNull();
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it("registers and returns a tracer when configured", async () => {
      vi.stubEnv("VITE_POSTHOG_API_KEY", "phc_test");
      vi.stubEnv("VITE_POSTHOG_API_HOST", "https://test.posthog.com");
      const { initOtelTracing } = await import("@renderer/utils/otel-trace");
      expect(initOtelTracing()).not.toBeNull();
      expect(mockRegister).toHaveBeenCalled();
    });
  });

  describe("traceNavigations", () => {
    it("starts a span on navigate and ends it on resolve", async () => {
      vi.stubEnv("VITE_POSTHOG_API_KEY", "phc_test");
      vi.stubEnv("VITE_POSTHOG_API_HOST", "https://test.posthog.com");
      const { initOtelTracing, traceNavigations } = await import(
        "@renderer/utils/otel-trace"
      );
      initOtelTracing();

      const handlers: Record<string, (e: unknown) => void> = {};
      const router = {
        subscribe: (event: string, cb: (e: unknown) => void) => {
          handlers[event] = cb;
        },
      } as never;
      traceNavigations(router);

      handlers.onBeforeNavigate({
        fromLocation: { pathname: "/a" },
        toLocation: { pathname: "/b" },
      });
      expect(mockStartSpan).toHaveBeenCalledWith("route.navigate");
      expect(span.setAttribute).toHaveBeenCalledWith("route.to", "/b");

      handlers.onResolved({});
      expect(span.end).toHaveBeenCalled();
    });
  });

  describe("onAppRender", () => {
    it("ignores commits under the threshold and spans slow ones", async () => {
      vi.stubEnv("VITE_POSTHOG_API_KEY", "phc_test");
      vi.stubEnv("VITE_POSTHOG_API_HOST", "https://test.posthog.com");
      const { initOtelTracing, onAppRender } = await import(
        "@renderer/utils/otel-trace"
      );
      initOtelTracing();

      onAppRender("app", "update", 4, 4, 0, 0);
      expect(mockStartSpan).not.toHaveBeenCalled();

      onAppRender("app", "update", 32, 30, 0, 0);
      expect(mockStartSpan).toHaveBeenCalledWith("react.commit app");
    });
  });
});
