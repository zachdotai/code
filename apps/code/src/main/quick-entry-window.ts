import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, globalShortcut, screen } from "electron";
import { isDevBuild } from "./utils/env";
import { logger } from "./utils/logger";
import { attachWindowToIPC } from "./window";

const log = logger.scope("quick-entry-window");

// electron-vite (unlike Forge) exposes the renderer dev-server URL via env
// rather than injected build-time globals; mirrors window.ts.
const MAIN_WINDOW_VITE_DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL;
const MAIN_WINDOW_VITE_NAME = "main_window";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const QUICK_ENTRY_WIDTH = 920;
// Window is taller than the visible glass panel: the transparent slack below
// hosts dropdown popovers and the textarea's autogrow without clipping.
const QUICK_ENTRY_HEIGHT = 520;
const QUICK_ENTRY_MIN_SIDE_MARGIN = 32;
// Panel top sits ~26% down the work area (Raycast-style), not bottom-docked.
const QUICK_ENTRY_TOP_RATIO = 0.26;

let quickEntryWindow: BrowserWindow | null = null;
let registeredAccelerator: string | null = null;

export interface QuickEntryWindowHandlers {
  onBlur: () => void;
}

export function createQuickEntryWindow(
  handlers: QuickEntryWindowHandlers,
): void {
  if (quickEntryWindow && !quickEntryWindow.isDestroyed()) return;
  const isDev = isDevBuild();

  const window = new BrowserWindow({
    width: QUICK_ENTRY_WIDTH,
    height: QUICK_ENTRY_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    roundedCorners: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      partition: "persist:main",
      additionalArguments: isDev
        ? ["--posthog-code-dev", "--posthog-quick-entry"]
        : ["--posthog-quick-entry"],
      ...(isDev && { webSecurity: false }),
    },
  });

  window.setAlwaysOnTop(true, "floating");
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  window.on("blur", () => {
    if (!quickEntryWindow || quickEntryWindow.isDestroyed()) return;
    handlers.onBlur();
  });

  window.on("closed", () => {
    if (quickEntryWindow === window) {
      quickEntryWindow = null;
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#quick-entry`);
  } else {
    window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { hash: "quick-entry" },
    );
  }

  attachWindowToIPC(window);

  quickEntryWindow = window;
  log.info("Quick entry window created");
}

export function isQuickEntryWindowVisible(): boolean {
  return (
    !!quickEntryWindow &&
    !quickEntryWindow.isDestroyed() &&
    quickEntryWindow.isVisible()
  );
}

export function isQuickEntryWindowFocused(): boolean {
  return (
    !!quickEntryWindow &&
    !quickEntryWindow.isDestroyed() &&
    quickEntryWindow.isFocused()
  );
}

export function showQuickEntryWindow(): boolean {
  const window = quickEntryWindow;
  if (!window || window.isDestroyed()) {
    log.warn("showQuickEntryWindow called before window exists");
    return false;
  }
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;
  const width = Math.min(
    QUICK_ENTRY_WIDTH,
    dw - QUICK_ENTRY_MIN_SIDE_MARGIN * 2,
  );
  const height = Math.min(QUICK_ENTRY_HEIGHT, dh);
  const x = Math.round(dx + (dw - width) / 2);
  const y = Math.round(dy + dh * QUICK_ENTRY_TOP_RATIO);
  // resizable:false blocks programmatic setBounds on macOS; lift it briefly.
  window.setResizable(true);
  window.setBounds({ x, y, width, height }, false);
  window.setResizable(false);

  window.show();
  window.focus();
  app.focus({ steal: true });
  return true;
}

export function hideQuickEntryWindow(): void {
  const window = quickEntryWindow;
  if (!window || window.isDestroyed()) return;
  if (!window.isVisible()) return;
  window.hide();
}

export function destroyQuickEntryWindow(): void {
  const window = quickEntryWindow;
  quickEntryWindow = null;
  if (window && !window.isDestroyed()) {
    window.destroy();
  }
}

export function registerQuickEntryShortcut(
  accelerator: string,
  handler: () => void,
): boolean {
  if (
    registeredAccelerator === accelerator &&
    globalShortcut.isRegistered(accelerator)
  ) {
    return true;
  }
  unregisterQuickEntryShortcut();
  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, handler);
  } catch (err) {
    // globalShortcut.register throws on malformed accelerator strings.
    log.warn(`Invalid quick-entry accelerator: ${accelerator}`, err);
    return false;
  }
  if (ok) {
    registeredAccelerator = accelerator;
    log.info(`Registered quick-entry global shortcut: ${accelerator}`);
  } else {
    log.warn(
      `Failed to register quick-entry global shortcut (held by another app?): ${accelerator}`,
    );
  }
  return ok;
}

export function unregisterQuickEntryShortcut(): void {
  if (!registeredAccelerator) return;
  if (globalShortcut.isRegistered(registeredAccelerator)) {
    globalShortcut.unregister(registeredAccelerator);
  }
  log.info(
    `Unregistered quick-entry global shortcut: ${registeredAccelerator}`,
  );
  registeredAccelerator = null;
}
