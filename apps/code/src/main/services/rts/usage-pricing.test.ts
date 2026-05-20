import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { computeCostUsd, hasPricingFor } from "./usage-pricing";

describe("computeCostUsd", () => {
  it("computes Opus 4.7 cost across all four token columns", () => {
    const cost = computeCostUsd(
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
      },
      "claude-opus-4-7",
    );
    expect(cost).toBeCloseTo(15.0 + 75.0 + 1.5 + 18.75, 6);
  });

  it("scales linearly with token count", () => {
    const oneM = computeCostUsd(
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      "claude-sonnet-4-6",
    );
    const tenM = computeCostUsd(
      {
        inputTokens: 10_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      "claude-sonnet-4-6",
    );
    expect(tenM).toBeCloseTo(oneM * 10, 6);
  });

  it("matches dated model variants by prefix", () => {
    const cost = computeCostUsd(
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      "claude-sonnet-4-6-20251001",
    );
    expect(cost).toBeCloseTo(3.0, 6);
  });

  it("returns 0 for unknown models without throwing", () => {
    const cost = computeCostUsd(
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      "no-such-model",
    );
    expect(cost).toBe(0);
  });

  it("returns 0 for zero token counts", () => {
    const cost = computeCostUsd(
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      "claude-opus-4-7",
    );
    expect(cost).toBe(0);
  });
});

describe("hasPricingFor", () => {
  it("returns true for known models", () => {
    expect(hasPricingFor("claude-opus-4-7")).toBe(true);
    expect(hasPricingFor("claude-sonnet-4-6")).toBe(true);
    expect(hasPricingFor("claude-haiku-4-5")).toBe(true);
    expect(hasPricingFor("gpt-5.5")).toBe(true);
  });

  it("returns true for prefix matches", () => {
    expect(hasPricingFor("claude-opus-4-7-20260101")).toBe(true);
  });

  it("returns false for unknown models", () => {
    expect(hasPricingFor("unknown-model")).toBe(false);
  });
});
