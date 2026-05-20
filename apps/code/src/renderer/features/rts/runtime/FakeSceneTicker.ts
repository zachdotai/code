import type { SceneTicker, TickListener } from "./SceneTicker";

/**
 * In-memory SceneTicker that only ticks when `step(deltaMs)` is called.
 * Used in tests so simulation logic can be advanced deterministically
 * without depending on `requestAnimationFrame` or wall-clock time.
 */
export class FakeSceneTicker implements SceneTicker {
  private listeners = new Set<TickListener>();
  private frameCount = 0;

  on(listener: TickListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  step(deltaMs: number): void {
    this.frameCount++;
    const snapshot = Array.from(this.listeners);
    for (const listener of snapshot) listener(deltaMs, this.frameCount);
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}
