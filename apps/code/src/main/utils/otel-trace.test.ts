import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetTracer = vi.fn(() => ({}) as unknown);
const mockRegister = vi.fn();
const mockForceFlush = vi.fn(() => Promise.resolve());
const mockShutdown = vi.fn(() => Promise.resolve());

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class {
    constructor(public config: unknown) {}
  },
}));

vi.mock("@opentelemetry/sdk-trace-base", () => ({
  BatchSpanProcessor: class {
    constructor(
      public _exporter: unknown,
      public _opts: unknown,
    ) {}
  },
  ParentBasedSampler: class {
    constructor(public _opts: unknown) {}
  },
  TraceIdRatioBasedSampler: class {
    constructor(public _ratio: number) {}
  },
}));

vi.mock("@opentelemetry/sdk-trace-node", () => ({
  NodeTracerProvider: class {
    constructor(public _opts: unknown) {}
    register() {
      return mockRegister();
    }
    getTracer() {
      return mockGetTracer();
    }
    forceFlush() {
      return mockForceFlush();
    }
    shutdown() {
      return mockShutdown();
    }
  },
}));

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: vi.fn((attrs: Record<string, string>) => attrs),
}));

vi.mock("@opentelemetry/semantic-conventions", () => ({
  ATTR_SERVICE_NAME: "service.name",
  ATTR_SERVICE_VERSION: "service.version",
}));

describe("otel-trace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    process.env.POSTHOG_CODE_VERSION = "1.0.0-test";
  });

  describe("initOtelTracing", () => {
    it.each([
      ["key missing", "", "https://test.posthog.com"],
      ["host missing", "phc_test123", ""],
      ["host invalid", "phc_test123", "not a url"],
    ])("returns null when %s", async (_case, key, host) => {
      vi.stubEnv("VITE_POSTHOG_API_KEY", key);
      vi.stubEnv("VITE_POSTHOG_API_HOST", host);

      const { initOtelTracing, getMainTracer } = await import(
        "@main/utils/otel-trace"
      );

      expect(initOtelTracing()).toBeNull();
      expect(getMainTracer()).toBeNull();
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it("registers a provider and returns a tracer when configured", async () => {
      vi.stubEnv("VITE_POSTHOG_API_KEY", "phc_test123");
      vi.stubEnv("VITE_POSTHOG_API_HOST", "https://test.posthog.com");

      const { initOtelTracing, getMainTracer } = await import(
        "@main/utils/otel-trace"
      );
      const tracer = initOtelTracing();

      expect(tracer).not.toBeNull();
      expect(getMainTracer()).toBe(tracer);
      expect(mockRegister).toHaveBeenCalled();
    });
  });

  describe("shutdownOtelTracing", () => {
    it("flushes and shuts down the provider", async () => {
      vi.stubEnv("VITE_POSTHOG_API_KEY", "phc_test123");
      vi.stubEnv("VITE_POSTHOG_API_HOST", "https://test.posthog.com");

      const { initOtelTracing, shutdownOtelTracing } = await import(
        "@main/utils/otel-trace"
      );
      initOtelTracing();

      await shutdownOtelTracing();

      expect(mockForceFlush).toHaveBeenCalled();
      expect(mockShutdown).toHaveBeenCalled();
    });

    it("is a no-op when provider was never created", async () => {
      vi.stubEnv("VITE_POSTHOG_API_KEY", "");

      const { initOtelTracing, shutdownOtelTracing } = await import(
        "@main/utils/otel-trace"
      );
      initOtelTracing();

      await expect(shutdownOtelTracing()).resolves.toBeUndefined();
      expect(mockForceFlush).not.toHaveBeenCalled();
    });
  });
});
