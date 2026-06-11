import { exposeElectronTRPC } from "@posthog/electron-trpc/main";
import { contextBridge, webUtils } from "electron";
import "electron-log/preload";

const SESSION_ID_ARG = "--posthog-session-id=";
const posthogSessionId = process.argv
  .find((arg) => arg.startsWith(SESSION_ID_ARG))
  ?.slice(SESSION_ID_ARG.length);

contextBridge.exposeInMainWorld("electronUtils", {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  posthogSessionId,
});

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
