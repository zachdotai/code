import { describe, expect, it, vi } from "vitest";
import { Logger } from "../utils/logger";
import { AddOnRegistry } from "./registry";
import type { AddOnContext, AddOnContribution, AddOnDefinition } from "./types";

function makeCtx(adapter: "claude" | "codex" = "claude"): AddOnContext {
  return {
    cwd: "/tmp/fake-cwd",
    adapter,
    logger: new Logger(),
  };
}

function makeDefinition(
  overrides: Partial<AddOnDefinition<{ value?: string }>> = {},
): AddOnDefinition<{ value?: string }> {
  return {
    name: "test",
    parseOptions: (raw) => raw as { value?: string },
    contribute: () => ({}),
    ...overrides,
  };
}

describe("AddOnRegistry", () => {
  it("returns an empty contribution when no config is provided", async () => {
    const registry = new AddOnRegistry();
    const result = await registry.collect(undefined, makeCtx());
    expect(result).toEqual({});
  });

  it("merges env vars from multiple add-ons (later wins on conflict)", async () => {
    const registry = new AddOnRegistry();
    registry.register(
      makeDefinition({
        name: "a",
        contribute: () => ({ env: { SHARED: "from-a", A_ONLY: "1" } }),
      }),
    );
    registry.register(
      makeDefinition({
        name: "b",
        contribute: () => ({ env: { SHARED: "from-b", B_ONLY: "1" } }),
      }),
    );

    const result = await registry.collect({ a: {}, b: {} }, makeCtx());
    expect(result.env).toEqual({
      SHARED: "from-b",
      A_ONLY: "1",
      B_ONLY: "1",
    });
  });

  it("concatenates systemPromptAppend across add-ons in iteration order", async () => {
    const registry = new AddOnRegistry();
    registry.register(
      makeDefinition({
        name: "a",
        contribute: () => ({ systemPromptAppend: "AA" }),
      }),
    );
    registry.register(
      makeDefinition({
        name: "b",
        contribute: () => ({ systemPromptAppend: "BB" }),
      }),
    );

    const result = await registry.collect({ a: {}, b: {} }, makeCtx());
    expect(result.systemPromptAppend).toBe("AABB");
  });

  it("aggregates preToolUse and postToolUse hooks", async () => {
    const registry = new AddOnRegistry();
    const hookA = vi.fn();
    const hookB = vi.fn();
    registry.register(
      makeDefinition({
        name: "a",
        contribute: (): AddOnContribution => ({
          preToolUse: [hookA],
          postToolUse: [hookB],
        }),
      }),
    );

    const result = await registry.collect({ a: {} }, makeCtx());
    expect(result.preToolUse).toEqual([hookA]);
    expect(result.postToolUse).toEqual([hookB]);
  });

  it("skips add-ons not supported on the current adapter", async () => {
    const registry = new AddOnRegistry();
    registry.register(
      makeDefinition({
        name: "claude-only",
        supportedAdapters: ["claude"],
        contribute: () => ({ systemPromptAppend: "should-not-appear" }),
      }),
    );

    const result = await registry.collect(
      { "claude-only": {} },
      makeCtx("codex"),
    );
    expect(result.systemPromptAppend).toBeUndefined();
  });

  it("skips unknown add-on names with a warning instead of throwing", async () => {
    const registry = new AddOnRegistry();
    const ctx = makeCtx();
    const warnSpy = vi.spyOn(ctx.logger, "warn").mockImplementation(() => {});

    await expect(
      registry.collect({ "does-not-exist": {} }, ctx),
    ).resolves.toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("does-not-exist"),
      expect.objectContaining({ addOn: "does-not-exist" }),
    );
  });

  it("skips add-ons whose options fail parsing instead of throwing", async () => {
    const registry = new AddOnRegistry();
    registry.register(
      makeDefinition({
        name: "strict",
        parseOptions: () => {
          throw new Error("bad options");
        },
        contribute: () => ({ env: { SHOULD_NOT: "1" } }),
      }),
    );
    const ctx = makeCtx();
    const warnSpy = vi.spyOn(ctx.logger, "warn").mockImplementation(() => {});

    const result = await registry.collect({ strict: { x: 1 } }, ctx);
    expect(result.env).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("strict"),
      expect.objectContaining({ addOn: "strict" }),
    );
  });

  it("awaits prepare() before contribute()", async () => {
    const registry = new AddOnRegistry();
    const order: string[] = [];
    registry.register(
      makeDefinition({
        name: "ordered",
        prepare: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push("prepare");
        },
        contribute: () => {
          order.push("contribute");
          return {};
        },
      }),
    );

    await registry.collect({ ordered: {} }, makeCtx());
    expect(order).toEqual(["prepare", "contribute"]);
  });

  it("propagates prepare() failures so missing prerequisites surface early", async () => {
    const registry = new AddOnRegistry();
    registry.register(
      makeDefinition({
        name: "needs-binary",
        prepare: () => {
          throw new Error("binary missing");
        },
      }),
    );

    await expect(
      registry.collect({ "needs-binary": {} }, makeCtx()),
    ).rejects.toThrow("binary missing");
  });

  it("rejects duplicate registrations", () => {
    const registry = new AddOnRegistry();
    registry.register(makeDefinition({ name: "dup" }));
    expect(() => registry.register(makeDefinition({ name: "dup" }))).toThrow(
      /already registered/,
    );
  });
});
