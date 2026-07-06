import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../types";
import {
  DEFAULT_STALE_COSTLY_THRESHOLD,
  extractContextUsage,
  extractLastActivityAt,
  shouldWarnStaleCostlyConversation,
} from "./contextUsage";

function usageEvent(
  used: number,
  ts = 1,
  cost?: { amount: number; currency: string },
): SessionEvent {
  return {
    type: "session_update",
    ts,
    notification: {
      update: { sessionUpdate: "usage_update", used, size: 200_000, cost },
    },
  };
}

function chunkEvent(ts = 1): SessionEvent {
  return {
    type: "session_update",
    ts,
    notification: {
      update: { sessionUpdate: "agent_message_chunk" },
    },
  };
}

function acpEvent(ts: number): SessionEvent {
  return { type: "acp_message", direction: "agent", ts, message: {} };
}

describe("extractContextUsage", () => {
  it("returns null with no usage event", () => {
    expect(extractContextUsage([])).toBeNull();
    expect(extractContextUsage([chunkEvent()])).toBeNull();
  });

  it("derives usage from the latest usage_update", () => {
    const result = extractContextUsage([
      usageEvent(20_000),
      usageEvent(50_000),
    ]);
    expect(result).toEqual({ used: 50_000, cost: null });
  });

  it("extracts cost when present", () => {
    const result = extractContextUsage([
      usageEvent(50_000, 1, { amount: 1.23, currency: "USD" }),
    ]);
    expect(result?.cost).toEqual({ amount: 1.23, currency: "USD" });
  });

  it("ignores usage_update events with non-numeric fields", () => {
    const bad: SessionEvent = {
      type: "session_update",
      ts: 1,
      notification: { update: { sessionUpdate: "usage_update" } },
    };
    expect(extractContextUsage([bad])).toBeNull();
  });
});

describe("extractLastActivityAt", () => {
  it("returns null for an empty list", () => {
    expect(extractLastActivityAt([])).toBeNull();
  });

  it("returns the maximum ts across event types and order", () => {
    expect(
      extractLastActivityAt([usageEvent(1, 30), acpEvent(10), chunkEvent(20)]),
    ).toBe(30);
  });
});

describe("shouldWarnStaleCostlyConversation", () => {
  const now = 1_000_000_000;
  const threshold = { tokens: 40_000, staleMs: 5 * 60 * 1000 };

  it.each([
    {
      name: "large + stale → warn",
      used: 50_000,
      idleMs: 10 * 60_000,
      out: true,
    },
    { name: "large + fresh → no", used: 50_000, idleMs: 60_000, out: false },
    {
      name: "small + stale → no",
      used: 10_000,
      idleMs: 10 * 60_000,
      out: false,
    },
    {
      name: "at both thresholds → warn",
      used: 40_000,
      idleMs: 5 * 60_000,
      out: true,
    },
    {
      name: "one ms below stale → no",
      used: 50_000,
      idleMs: 5 * 60_000 - 1,
      out: false,
    },
  ])("$name", ({ used, idleMs, out }) => {
    expect(
      shouldWarnStaleCostlyConversation({
        usedTokens: used,
        lastActivityAt: now - idleMs,
        now,
        threshold,
      }),
    ).toBe(out);
  });

  it("never warns without a last-activity timestamp", () => {
    expect(
      shouldWarnStaleCostlyConversation({
        usedTokens: 1_000_000,
        lastActivityAt: null,
        now,
        threshold,
      }),
    ).toBe(false);
  });

  it("treats a future timestamp (clock skew) as fresh", () => {
    expect(
      shouldWarnStaleCostlyConversation({
        usedTokens: 50_000,
        lastActivityAt: now + 60_000,
        now,
        threshold,
      }),
    ).toBe(false);
  });

  it("falls back to the default threshold", () => {
    expect(
      shouldWarnStaleCostlyConversation({
        usedTokens: DEFAULT_STALE_COSTLY_THRESHOLD.tokens,
        lastActivityAt: now - DEFAULT_STALE_COSTLY_THRESHOLD.staleMs,
        now,
      }),
    ).toBe(true);
  });
});
