import { isSafeExternalUrl } from "@posthog/shared";
import { type BrowserWindow, shell } from "electron";
import { logger } from "./utils/logger";

const log = logger.scope("external-links");

const MAIN_WINDOW_VITE_DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL;

function urlScheme(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return "<unparseable>";
  }
}

// `shell.openExternal` dispatches to whatever app the OS registered for the
// scheme, so it must never receive a scheme outside the http/https/mailto
// allowlist: renderer content (including sandboxed MCP apps) can reach these
// handlers via window.open/navigation with e.g. smb:, file:, or ms-msdt: URLs.
function openExternalIfSafe(url: string): void {
  if (!isSafeExternalUrl(url)) {
    log.warn("Blocked externally-opened URL with disallowed scheme", {
      scheme: urlScheme(url),
    });
    return;
  }
  void shell.openExternal(url);
}

export function setupExternalLinkHandlers(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const appUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL || "file://";
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      openExternalIfSafe(url);
    }
  });
}
