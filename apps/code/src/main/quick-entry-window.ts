import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, globalShortcut, screen } from "electron";
import { isDevBuild } from "./utils/env";
import { logger } from "./utils/logger";
import { attachWindowToIPC } from "./window";

const log = logger.scope("quick-entry-window");

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const QUICK_ENTRY_WIDTH = 960;
const QUICK_ENTRY_HEIGHT = 170;
const QUICK_ENTRY_BOTTOM_MARGIN = 120;
const QUICK_ENTRY_ACCELERATOR = "Alt+Space";

let quickEntryWindow: BrowserWindow | null = null;

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
  const x = Math.round(dx + (dw - QUICK_ENTRY_WIDTH) / 2);
  const y = Math.round(
    dy + dh - QUICK_ENTRY_HEIGHT - QUICK_ENTRY_BOTTOM_MARGIN,
  );
  window.setPosition(x, y, false);

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

export function registerQuickEntryShortcut(handler: () => void): boolean {
  if (globalShortcut.isRegistered(QUICK_ENTRY_ACCELERATOR)) {
    return true;
  }
  const ok = globalShortcut.register(QUICK_ENTRY_ACCELERATOR, handler);
  if (ok) {
    log.info(
      `Registered quick-entry global shortcut: ${QUICK_ENTRY_ACCELERATOR}`,
    );
  } else {
    log.warn(
      `Failed to register quick-entry global shortcut: ${QUICK_ENTRY_ACCELERATOR}`,
    );
  }
  return ok;
}

export function unregisterQuickEntryShortcut(): void {
  if (!globalShortcut.isRegistered(QUICK_ENTRY_ACCELERATOR)) return;
  globalShortcut.unregister(QUICK_ENTRY_ACCELERATOR);
  log.info(
    `Unregistered quick-entry global shortcut: ${QUICK_ENTRY_ACCELERATOR}`,
  );
}
