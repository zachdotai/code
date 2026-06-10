import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RafSceneTicker } from "./SceneTicker";

interface FrameCallback {
  cb: FrameRequestCallback;
  cancelled: boolean;
}

interface RafHarness {
  request: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  pending: FrameCallback[];
  /** Fire the next queued callback with `ts`. Returns whether one fired. */
  fire(ts: number): boolean;
  /** Fire callbacks until the queue is empty or `maxFrames` is reached. */
  drain(startTs: number, stepMs: number, maxFrames: number): void;
}

function installRafHarness(): RafHarness {
  const pending: FrameCallback[] = [];
  let nextHandle = 1;
  const handles = new Map<number, FrameCallback>();

  const request = vi.fn((cb: FrameRequestCallback): number => {
    const handle = nextHandle++;
    const frame: FrameCallback = { cb, cancelled: false };
    pending.push(frame);
    handles.set(handle, frame);
    return handle;
  });

  const cancel = vi.fn((handle: number) => {
    const frame = handles.get(handle);
    if (frame) frame.cancelled = true;
  });

  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);

  function fire(ts: number): boolean {
    while (pending.length > 0) {
      const next = pending.shift();
      if (!next) return false;
      if (next.cancelled) continue;
      next.cb(ts);
      return true;
    }
    return false;
  }

  function drain(startTs: number, stepMs: number, maxFrames: number) {
    let ts = startTs;
    for (let i = 0; i < maxFrames; i++) {
      if (!fire(ts)) return;
      ts += stepMs;
    }
  }

  return { request, cancel, pending, fire, drain };
}

describe("RafSceneTicker", () => {
  let raf: RafHarness;

  beforeEach(() => {
    raf = installRafHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not request a frame until a listener subscribes", () => {
    new RafSceneTicker();
    expect(raf.request).not.toHaveBeenCalled();
  });

  it("starts the rAF loop on first subscription", () => {
    const ticker = new RafSceneTicker();
    ticker.on(() => undefined);
    expect(raf.request).toHaveBeenCalledTimes(1);
  });

  it("stops the rAF loop when the last subscriber unsubscribes", () => {
    const ticker = new RafSceneTicker();
    const unsubscribe = ticker.on(() => undefined);
    expect(raf.cancel).not.toHaveBeenCalled();
    unsubscribe();
    expect(raf.cancel).toHaveBeenCalledTimes(1);
  });

  it("only requests one rAF even with multiple subscribers", () => {
    const ticker = new RafSceneTicker();
    ticker.on(() => undefined);
    ticker.on(() => undefined);
    ticker.on(() => undefined);
    expect(raf.request).toHaveBeenCalledTimes(1);
  });

  it("delivers ticks to every subscriber", () => {
    const ticker = new RafSceneTicker();
    const a = vi.fn();
    const b = vi.fn();
    ticker.on(a);
    ticker.on(b);

    raf.fire(0);
    raf.fire(16);

    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("passes deltaMs computed from the rAF timestamp", () => {
    const ticker = new RafSceneTicker();
    const calls: number[] = [];
    ticker.on((dt) => calls.push(dt));

    raf.fire(0);
    raf.fire(16);
    raf.fire(48);

    expect(calls[0]).toBe(0);
    expect(calls[1]).toBe(16);
    expect(calls[2]).toBe(32);
  });

  it("caps deltaMs at the configured maximum", () => {
    const ticker = new RafSceneTicker(50);
    const calls: number[] = [];
    ticker.on((dt) => calls.push(dt));

    raf.fire(0);
    raf.fire(1000);

    expect(calls[1]).toBe(50);
  });

  it("increments frameCount on every tick", () => {
    const ticker = new RafSceneTicker();
    const calls: number[] = [];
    ticker.on((_dt, frame) => calls.push(frame));

    raf.drain(0, 16, 3);

    expect(calls).toEqual([1, 2, 3]);
  });

  it("schedules the next frame after delivering ticks while subscribers remain", () => {
    const ticker = new RafSceneTicker();
    ticker.on(() => undefined);
    raf.fire(0);
    expect(raf.request).toHaveBeenCalledTimes(2);
    raf.fire(16);
    expect(raf.request).toHaveBeenCalledTimes(3);
  });

  it("does not crash when a listener unsubscribes inside a tick", () => {
    const ticker = new RafSceneTicker();
    let unsubA: (() => void) | null = null;
    const a = vi.fn(() => {
      unsubA?.();
    });
    const b = vi.fn();
    unsubA = ticker.on(a);
    ticker.on(b);

    raf.fire(0);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    raf.fire(16);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("does not schedule another frame if every listener unsubscribes inside a tick", () => {
    const ticker = new RafSceneTicker();
    let unsubA: (() => void) | null = null;
    unsubA = ticker.on(() => {
      unsubA?.();
    });

    raf.request.mockClear();
    raf.fire(0);

    expect(raf.request).not.toHaveBeenCalled();
  });

  it("resumes correctly after going idle and resubscribing", () => {
    const ticker = new RafSceneTicker();
    const unsub = ticker.on(() => undefined);
    raf.fire(0);
    unsub();
    expect(raf.cancel).toHaveBeenCalledTimes(1);

    raf.request.mockClear();
    ticker.on(() => undefined);
    expect(raf.request).toHaveBeenCalledTimes(1);
  });
});
