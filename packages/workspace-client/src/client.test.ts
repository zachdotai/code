import { describe, expect, it } from "vitest";
import { tracePropagationHeaders } from "./client";

describe("tracePropagationHeaders", () => {
  it("adds no traceparent when tracing is disabled (no propagator registered)", () => {
    const base = { "x-workspace-secret": "abc" };
    const out = tracePropagationHeaders(base);
    expect(out).toEqual(base);
    expect(out).not.toHaveProperty("traceparent");
  });

  it("does not mutate the input headers object", () => {
    const base = { "x-workspace-secret": "abc" };
    tracePropagationHeaders(base);
    expect(base).toEqual({ "x-workspace-secret": "abc" });
  });
});
