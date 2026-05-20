import { describe, expect, it, vi } from "vitest";
import { FakeSceneTicker } from "./FakeSceneTicker";

describe("FakeSceneTicker", () => {
  it("delivers step() to every subscriber", () => {
    const ticker = new FakeSceneTicker();
    const a = vi.fn();
    const b = vi.fn();
    ticker.on(a);
    ticker.on(b);

    ticker.step(16);

    expect(a).toHaveBeenCalledWith(16, 1);
    expect(b).toHaveBeenCalledWith(16, 1);
  });

  it("increments frameCount across step() calls", () => {
    const ticker = new FakeSceneTicker();
    const calls: Array<[number, number]> = [];
    ticker.on((dt, frame) => calls.push([dt, frame]));

    ticker.step(10);
    ticker.step(20);
    ticker.step(30);

    expect(calls).toEqual([
      [10, 1],
      [20, 2],
      [30, 3],
    ]);
  });

  it("stops delivering after unsubscribe", () => {
    const ticker = new FakeSceneTicker();
    const listener = vi.fn();
    const unsub = ticker.on(listener);

    ticker.step(16);
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    ticker.step(16);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no listeners are registered", () => {
    const ticker = new FakeSceneTicker();
    expect(() => ticker.step(16)).not.toThrow();
  });

  it("tolerates unsubscribe inside a step callback", () => {
    const ticker = new FakeSceneTicker();
    let unsubA: (() => void) | null = null;
    const a = vi.fn(() => {
      unsubA?.();
    });
    const b = vi.fn();
    unsubA = ticker.on(a);
    ticker.on(b);

    expect(() => ticker.step(16)).not.toThrow();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    ticker.step(16);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("reports listenerCount", () => {
    const ticker = new FakeSceneTicker();
    expect(ticker.listenerCount()).toBe(0);
    const u1 = ticker.on(() => undefined);
    expect(ticker.listenerCount()).toBe(1);
    ticker.on(() => undefined);
    expect(ticker.listenerCount()).toBe(2);
    u1();
    expect(ticker.listenerCount()).toBe(1);
  });
});
