import { createPortBridge } from "@posthog/port-trpc/link";
import { fromDomPort } from "@posthog/port-trpc/transport-port";
import { NODE_HOST_PORT_CHANNEL } from "@posthog/shared/node-host-protocol";

declare global {
  interface Window {
    posthogNodeHost?: { requestPort: () => void };
  }
}

/**
 * The renderer's connection to the node-host utilityProcess: a MessagePort
 * wired straight to it, so agent.* traffic (token streams included) bypasses
 * the main process. Main relays the port via the preload
 * (`webContents.postMessage` → `window.postMessage` with the port transferred)
 * and re-issues one, with a bumped generation, whenever the utility restarts;
 * the bridge swaps ports, failing in-flight operations so SessionService's
 * existing auto-recovery reconnects.
 *
 * Operations issued before the first port arrives queue in the bridge, so the
 * split client below is safe to build synchronously at module load. In
 * non-Electron contexts (storybook, web) there is no preload — the request is
 * a no-op and the bridge simply never connects.
 */
export const nodeHostBridge = createPortBridge();

if (typeof window !== "undefined") {
  // Listener first, then the request — the response can't be missed.
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data as
      | { channel?: unknown; generation?: unknown }
      | undefined;
    if (!data || data.channel !== NODE_HOST_PORT_CHANNEL) return;
    const [port] = event.ports;
    if (!port) return;
    nodeHostBridge.connect(
      fromDomPort(port),
      typeof data.generation === "number" ? data.generation : undefined,
    );
  });
  window.posthogNodeHost?.requestPort();
}
