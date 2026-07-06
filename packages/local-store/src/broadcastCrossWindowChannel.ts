import type {
  CrossWindowChannel,
  CrossWindowConnection,
} from "@posthog/platform/cross-window-channel";

/**
 * Cross-window fan-out over the native BroadcastChannel API. Works across
 * Electron BrowserWindows (same origin + contextIsolation, both already true)
 * and browser tabs on the web host.
 */
export class BroadcastCrossWindowChannel implements CrossWindowChannel {
  open(name: string): CrossWindowConnection {
    const channel = new BroadcastChannel(name);
    const listeners = new Set<(data: unknown) => void>();

    channel.onmessage = (event: MessageEvent) => {
      for (const listener of listeners) {
        listener(event.data);
      }
    };

    return {
      postMessage(data: unknown): void {
        channel.postMessage(data);
      },
      subscribe(listener: (data: unknown) => void): () => void {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      close(): void {
        listeners.clear();
        channel.close();
      },
    };
  }
}
