import { exposeElectronTRPC } from "@posthog/electron-trpc/main";
import {
  NODE_HOST_PORT_CHANNEL,
  NODE_HOST_PORT_REQUEST,
} from "@posthog/shared/node-host-protocol";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import "electron-log/preload";
import { parseSessionIdArg } from "./posthog-session-arg";

const DEV_FLAGS_CLI_PREFIX = "--posthog-code-flags=";

function readDevFlags(): { devMode: boolean } {
  const arg = process.argv.find((a) => a.startsWith(DEV_FLAGS_CLI_PREFIX));
  if (!arg) return { devMode: false };
  try {
    const payload = decodeURIComponent(arg.slice(DEV_FLAGS_CLI_PREFIX.length));
    const parsed = JSON.parse(payload);
    return { devMode: parsed?.devMode === true };
  } catch {
    return { devMode: false };
  }
}

const devFlags = readDevFlags();

contextBridge.exposeInMainWorld("electronUtils", {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});

// MessagePorts cannot pass through the contextBridge; the documented pattern
// is to relay them into the main world with window.postMessage. The renderer's
// node-host bridge listens for this message and adopts the transferred port.
ipcRenderer.on(NODE_HOST_PORT_CHANNEL, (event, message) => {
  window.postMessage(
    { channel: NODE_HOST_PORT_CHANNEL, ...(message as object) },
    "*",
    event.ports,
  );
});

contextBridge.exposeInMainWorld("posthogNodeHost", {
  requestPort: () => ipcRenderer.send(NODE_HOST_PORT_REQUEST),
});

contextBridge.exposeInMainWorld("__posthogBootstrap", {
  sessionId: parseSessionIdArg(process.argv),
});

contextBridge.exposeInMainWorld("__posthogCodeDevFlags", devFlags);

if (process.argv.includes("--posthog-code-dev")) {
  contextBridge.exposeInMainWorld("__posthogCodeTest", {
    crash: () => {
      process.crash();
    },
    abort: () => {
      process.abort();
    },
  });
}

process.once("loaded", async () => {
  exposeElectronTRPC();
});
