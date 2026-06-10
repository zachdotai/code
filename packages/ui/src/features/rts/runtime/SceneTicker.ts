export type TickListener = (deltaMs: number, frameCount: number) => void;

export interface SceneTicker {
  /** Subscribe to per-frame ticks. Returns an unsubscribe function. */
  on(listener: TickListener): () => void;
}

/**
 * Drives a single `requestAnimationFrame` loop and fans the resulting
 * `(deltaMs, frameCount)` events out to every subscriber. Lazy: the rAF
 * loop only runs while there is at least one subscriber.
 *
 * Large frame gaps (tab backgrounded, breakpoint paused) are capped at
 * `maxDeltaMs` so simulation steps never see arbitrarily large dts —
 * matches the collision resolver's prior implicit behavior.
 */
export class RafSceneTicker implements SceneTicker {
  private listeners = new Set<TickListener>();
  private rafHandle: number | null = null;
  private lastTs: number | null = null;
  private frameCount = 0;
  private readonly maxDeltaMs: number;

  constructor(maxDeltaMs = 50) {
    this.maxDeltaMs = maxDeltaMs;
  }

  on(listener: TickListener): () => void {
    this.listeners.add(listener);
    this.ensureRunning();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private ensureRunning(): void {
    if (this.rafHandle !== null) return;
    this.lastTs = null;
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  private stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.lastTs = null;
  }

  private tick = (ts: number): void => {
    const deltaMs =
      this.lastTs === null ? 0 : Math.min(this.maxDeltaMs, ts - this.lastTs);
    this.lastTs = ts;
    this.frameCount++;

    // Snapshot listeners so unsubscribing inside a callback doesn't
    // mutate the set we're iterating over.
    const snapshot = Array.from(this.listeners);
    for (const listener of snapshot) listener(deltaMs, this.frameCount);

    if (this.listeners.size > 0) {
      this.rafHandle = requestAnimationFrame(this.tick);
    } else {
      this.rafHandle = null;
      this.lastTs = null;
    }
  };
}

export const sceneTicker: SceneTicker = new RafSceneTicker();
