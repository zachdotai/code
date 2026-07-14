import { isSafeExternalUrl } from "@posthog/shared";
import { type BrowserWindow, shell } from "electron";
import { logger } from "./utils/logger";

const log = logger.scope("external-links");

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
  // openExternal rejects when the OS has no handler for the scheme (or the user
  // dismisses the confirmation prompt on some platforms). Swallow it so a failed
  // open never surfaces as an unhandled rejection in the main process.
  shell.openExternal(url).catch((error) => {
    log.warn("shell.openExternal rejected", { scheme: urlScheme(url), error });
  });
}

// A navigation is "in-app" only when it targets the exact renderer origin (dev
// server) or a file under the packaged renderer directory. Comparing parsed
// URLs — rather than a startsWith prefix — stops lookalikes like
// http://localhost:5173.evil.example or file:///etc/passwd from being treated
// as internal and skipping the external-link scheme check below.
function isInAppNavigation(target: string, appHome: URL): boolean {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return false;
  }

  if (appHome.protocol === "file:") {
    // file: origins are all opaque ("null"), so pin to the directory that holds
    // index.html instead of comparing origins.
    if (parsed.protocol !== "file:") return false;
    const appDir = appHome.pathname.slice(
      0,
      appHome.pathname.lastIndexOf("/") + 1,
    );
    return parsed.pathname.startsWith(appDir);
  }

  // Dev server (http/https): pin scheme + host + port exactly.
  return parsed.origin === appHome.origin;
}

export function setupExternalLinkHandlers(
  window: BrowserWindow,
  appHome: URL,
): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isInAppNavigation(url, appHome)) return;
    event.preventDefault();
    openExternalIfSafe(url);
  });
}
