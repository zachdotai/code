import { describe, expect, it, vi } from "vitest";
import { withSpan } from "./with-span";

describe("withSpan", () => {
  it.each([
    ["resolves the wrapped value", 42, 42],
    ["resolves objects", { ok: true }, { ok: true }],
  ])("passes through when no tracer (%s)", async (_case, value, expected) => {
    await expect(withSpan(null, "op", {}, async () => value)).resolves.toEqual(
      expected,
    );
  });

  it("propagates errors when no tracer", async () => {
    await expect(
      withSpan(null, "op", {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("returns the value and ends the span on success", async () => {
    const span = {
      recordException: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };
    const tracer = {
      startActiveSpan: (
        _name: string,
        _opts: unknown,
        fn: (s: unknown) => unknown,
      ) => fn(span),
    } as never;

    await expect(
      withSpan(tracer, "op", { a: 1 }, async () => "done"),
    ).resolves.toBe("done");

    expect(span.end).toHaveBeenCalled();
    expect(span.recordException).not.toHaveBeenCalled();
    expect(span.setStatus).not.toHaveBeenCalled();
  });

  it("records exceptions and ends the span on error", async () => {
    const span = {
      recordException: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };
    const tracer = {
      startActiveSpan: (
        _name: string,
        _opts: unknown,
        fn: (s: unknown) => unknown,
      ) => fn(span),
    } as never;

    await expect(
      withSpan(tracer, "op", { a: 1 }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(span.recordException).toHaveBeenCalled();
    expect(span.setStatus).toHaveBeenCalled();
    expect(span.end).toHaveBeenCalled();
  });
});
