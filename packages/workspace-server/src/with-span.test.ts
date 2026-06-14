import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetTracer = vi.fn();

vi.mock("./otel-trace", () => ({
  getWorkspaceServerTracer: () => mockGetTracer(),
}));

describe("withSpan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["resolves the wrapped value", 42, 42],
    ["resolves objects", { ok: true }, { ok: true }],
  ])("passes through when no tracer (%s)", async (_case, value, expected) => {
    mockGetTracer.mockReturnValue(null);
    const { withSpan } = await import("./with-span");

    await expect(withSpan("op", {}, async () => value)).resolves.toEqual(
      expected,
    );
  });

  it("propagates errors when no tracer", async () => {
    mockGetTracer.mockReturnValue(null);
    const { withSpan } = await import("./with-span");

    await expect(
      withSpan("op", {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("records exceptions and ends the span on error", async () => {
    const span = {
      recordException: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };
    mockGetTracer.mockReturnValue({
      startActiveSpan: (
        _name: string,
        _opts: unknown,
        fn: (s: unknown) => unknown,
      ) => fn(span),
    });
    const { withSpan } = await import("./with-span");

    await expect(
      withSpan("op", { a: 1 }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(span.recordException).toHaveBeenCalled();
    expect(span.setStatus).toHaveBeenCalled();
    expect(span.end).toHaveBeenCalled();
  });
});
