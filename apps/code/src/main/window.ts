import path from "node:path";
import { fileURLToPath } from "node:url";
import { createIPCHandler } from "@posthog/electron-trpc/main";
import { MAIN_WINDOW_SERVICE } from "@posthog/platform/main-window";
import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  screen,
  shell,
} from "electron";
import { container } from "./di/container";
import { buildApplicationMenu } from "./menu";
import type { ElectronMainWindow } from "./platform-adapters/electron-main-window";
import { posthogNodeAnalytics } from "./platform-adapters/posthog-analytics";
import { POSTHOG_SESSION_ID_ARG } from "./posthog-session-arg";
import {
  encodeDevFlagsForArg,
  readDevFlagsSync,
} from "./services/dev-flags/service";
import { trpcRouter } from "./trpc/router";
import { collectMemorySnapshot } from "./utils/crash-diagnostics";
import { isDevBuild } from "./utils/env";
import { logger, readChromiumLogTail } from "./utils/logger";
import {
  saveFullScreenState,
  saveZoomLevel,
  setRestoreFullScreenOnNextLaunch,
  type WindowStateSchema,
  windowStateStore,
} from "./utils/store";
import {
  isAllowedWebviewNavigation,
  safeProtocol,
} from "./utils/webview-navigation-guard";

const log = logger.scope("window");
const trpcLog = logger.scope("host-trpc");

const MAIN_WINDOW_VITE_DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL;
const MAIN_WINDOW_VITE_NAME = "main_window";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isPositionOnScreen(x: number, y: number): boolean {
  const displays = screen.getAllDisplays();
  return displays.some((display) => {
    const { x: dx, y: dy, width, height } = display.bounds;
    return x >= dx && x < dx + width && y >= dy && y < dy + height;
  });
}

function getSavedWindowState(): WindowStateSchema {
  const state = {
    x: windowStateStore.get("x"),
    y: windowStateStore.get("y"),
    width: windowStateStore.get("width", 1200),
    height: windowStateStore.get("height", 600),
    isMaximized: windowStateStore.get("isMaximized", true),
    zoomLevel: windowStateStore.get("zoomLevel", 0),
    isFullScreen: windowStateStore.get("isFullScreen", false),
    restoreFullScreenOnNextLaunch: windowStateStore.get(
      "restoreFullScreenOnNextLaunch",
      false,
    ),
  };

  // Validate position is still on a connected display
  if (state.x !== undefined && state.y !== undefined) {
    if (!isPositionOnScreen(state.x, state.y)) {
      state.x = undefined;
      state.y = undefined;
    }
  }

  return state;
}

export function saveWindowState(window: BrowserWindow): void {
  const isMaximized = window.isMaximized();
  windowStateStore.set("isMaximized", isMaximized);

  // Only save bounds when not maximized, so restoring from maximized
  // gives the user their previous windowed size/position
  if (!isMaximized && !window.isFullScreen()) {
    const bounds = window.getBounds();
    windowStateStore.set("x", bounds.x);
    windowStateStore.set("y", bounds.y);
    windowStateStore.set("width", bounds.width);
    windowStateStore.set("height", bounds.height);
  }
}

let mainWindow: BrowserWindow | null = null;

export function focusMainWindow(reason: string): void {
  if (mainWindow) {
    log.info("focusMainWindow called", {
      reason,
      isMinimized: mainWindow.isMinimized(),
      isFocused: mainWindow.isFocused(),
      isVisible: mainWindow.isVisible(),
      stack: new Error().stack,
    });
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

function setupExternalLinkHandlers(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const appUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL || "file://";
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

// The guest runs on a shared persisted profile, so a single grant would stick
// across every tab and task — deny powerful permissions outright.
const DENIED_WEBVIEW_PERMISSIONS = new Set([
  "media", // camera + microphone
  "geolocation",
  "notifications",
  "midi",
  "midiSysex",
  "hid",
  "serial",
  "usb",
  "pointerLock",
  "idle-detection",
  "openExternal", // popups are already routed through our own handler
]);

// Every browser webview shares the one persist:browser session, and Electron's
// setPermissionRequestHandler REPLACES the session's previous handler rather
// than stacking. Re-installing on every webview attach would mean the latest
// attach silently wins; this WeakSet makes installation once-per-session so
// that can never happen.
const hardenedWebviewSessions = new WeakSet<Electron.Session>();

function hardenWebviewSession(session: Electron.Session): void {
  if (hardenedWebviewSessions.has(session)) return;
  hardenedWebviewSessions.add(session);

  // Chromium consults two hooks when a page uses a permission-gated API:
  // setPermissionRequestHandler decides explicit requests (the ones that would
  // show a prompt, e.g. getUserMedia), and setPermissionCheckHandler answers
  // synchronous status probes (navigator.permissions.query). Both must deny
  // the same list, otherwise a page could see "granted" via the check path
  // while actual requests are refused, or vice versa.
  session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(!DENIED_WEBVIEW_PERMISSIONS.has(permission));
  });
  session.setPermissionCheckHandler(
    (_wc, permission) => !DENIED_WEBVIEW_PERMISSIONS.has(permission),
  );
}

// Hardens <webview> guests used by the in-app browser tab. The guest renders
// arbitrary untrusted web content inside a privileged app window.
function setupWebviewHandlers(window: BrowserWindow): void {
  // Strip any preload / node access an attacker page might request.
  window.webContents.on("will-attach-webview", (_event, webPreferences) => {
    webPreferences.preload = undefined;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });

  window.webContents.on("did-attach-webview", (_event, guest) => {
    hardenWebviewSession(guest.session);

    guest.setWindowOpenHandler(({ url }) => {
      // http(s)-only: a hostile page must not launch external protocol
      // handlers (smb:, file:, custom app URIs) via window.open.
      if (/^https?:$/i.test(safeProtocol(url))) {
        shell.openExternal(url);
      } else {
        log.warn("Blocked webview popup to non-http(s) target", { url });
      }
      return { action: "deny" };
    });

    const guard = (
      event: { preventDefault: () => void },
      url: string,
    ): void => {
      if (!isAllowedWebviewNavigation(url)) {
        event.preventDefault();
        log.warn("Blocked disallowed webview navigation", { url });
      }
    };
    // will-navigate + will-redirect cover top-level loads and redirect chains
    // (the SSRF-to-metadata vector); will-frame-navigate covers sub-frames.
    guest.on("will-navigate", guard);
    guest.on("will-redirect", guard);
    guest.on("will-frame-navigate", (details) => guard(details, details.url));
  });
}

function setupCrashLogging(window: BrowserWindow): void {
  window.webContents.on("render-process-gone", (_event, details) => {
    log.error("Renderer process gone", {
      reason: details.reason,
      exitCode: details.exitCode,
      url: window.webContents.getURL(),
      memory: collectMemorySnapshot(() => app.getAppMetrics()),
      chromiumLogTail: readChromiumLogTail(),
    });
  });

  window.on("unresponsive", () => {
    log.warn("Window unresponsive", {
      url: window.webContents.getURL(),
      memory: collectMemorySnapshot(() => app.getAppMetrics()),
      chromiumLogTail: readChromiumLogTail(),
    });
  });

  window.on("responsive", () => {
    log.info("Window responsive again");
  });
}

function setupEditableContextMenu(window: BrowserWindow): void {
  window.webContents.on("context-menu", (_event, params) => {
    if (!params.isEditable) return;
    const { editFlags } = params;
    const template: MenuItemConstructorOptions[] = [
      { role: "undo", enabled: editFlags.canUndo },
      { role: "redo", enabled: editFlags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: editFlags.canCut },
      { role: "copy", enabled: editFlags.canCopy },
      { role: "paste", enabled: editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll", enabled: editFlags.canSelectAll },
    ];
    Menu.buildFromTemplate(template).popup({ window });
  });
}

export function createWindow(): void {
  const isDev = isDevBuild();
  const savedState = getSavedWindowState();

  // Read the one-shot fullscreen-restore flag and clear it immediately, so it
  // only ever affects the single launch that follows an update restart.
  const restoreFullScreen = savedState.restoreFullScreenOnNextLaunch;
  if (restoreFullScreen) {
    setRestoreFullScreenOnNextLaunch(false);
  }

  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  const scheduleSaveWindowState = (window: BrowserWindow): void => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    saveTimeout = setTimeout(() => {
      if (!window.isDestroyed()) {
        saveWindowState(window);
      }
      saveTimeout = null;
    }, 200);
  };

  const platformWindowConfig =
    process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          // Centre the traffic lights vertically with the title bar's back/forward
          // buttons (40px bar, 24px buttons → centre at y=20; 12px dots → top at 14).
          // x mirrors y so the inset from the top and the left match.
          trafficLightPosition: { x: 14, y: 14 },
        }
      : process.platform === "win32"
        ? {
            titleBarStyle: "hidden" as const,
            titleBarOverlay: {
              color: "#0a0a0a",
              symbolColor: "#ffffff",
              height: 36,
            },
          }
        : {};

  // macOS uses the .app bundle icon, but Linux/Windows need an explicit icon
  const windowIcon =
    process.platform !== "darwin"
      ? app.isPackaged
        ? path.join(process.resourcesPath, "app-icon.png")
        : path.join(app.getAppPath(), "build/app-icon.png")
      : undefined;

  mainWindow = new BrowserWindow({
    ...(savedState.x !== undefined && { x: savedState.x }),
    ...(savedState.y !== undefined && { y: savedState.y }),
    width: savedState.width,
    height: savedState.height,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    ...(windowIcon ? { icon: windowIcon } : {}),
    ...platformWindowConfig,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      preload: path.join(__dirname, "preload.js"),
      enableBlinkFeatures: "GetDisplayMedia",
      partition: "persist:main",
      additionalArguments: [
        ...(isDev ? ["--posthog-code-dev"] : []),
        `${POSTHOG_SESSION_ID_ARG}${posthogNodeAnalytics.getOrCreateSessionId()}`,
        encodeDevFlagsForArg(readDevFlagsSync()),
      ],
      ...(isDev && { webSecurity: false }),
    },
  });

  let windowShown = false;
  const showWindow = () => {
    if (windowShown) return;
    windowShown = true;
    clearTimeout(showFallback);
    if (restoreFullScreen) {
      mainWindow?.setFullScreen(true);
    } else if (savedState.isMaximized) {
      mainWindow?.maximize();
    }
    mainWindow?.show();
    mainWindow?.moveTop();
    mainWindow?.focus();
    app.focus({ steal: true });
  };

  mainWindow.once("ready-to-show", showWindow);
  const showFallback = setTimeout(showWindow, 3000);

  // Restore the zoom level once the renderer has loaded. Read the latest
  // persisted value from the store (not the create-time snapshot) so zooming
  // done during the session survives in-app reloads, which otherwise reset
  // Chromium's per-webContents zoom.
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.setZoomLevel(windowStateStore.get("zoomLevel", 0));
  });

  // Persist mouse-wheel/pinch zoom. Menu-driven zoom is persisted by the
  // menu items themselves (see buildViewMenu in menu.ts).
  mainWindow.webContents.on("zoom-changed", () => {
    if (mainWindow) {
      saveZoomLevel(mainWindow.webContents.getZoomLevel());
    }
  });

  // Persist window state on changes
  mainWindow.on(
    "resize",
    () => mainWindow && scheduleSaveWindowState(mainWindow),
  );
  mainWindow.on(
    "move",
    () => mainWindow && scheduleSaveWindowState(mainWindow),
  );
  mainWindow.on("maximize", () => mainWindow && saveWindowState(mainWindow));
  mainWindow.on("unmaximize", () => mainWindow && saveWindowState(mainWindow));
  mainWindow.on("close", () => mainWindow && saveWindowState(mainWindow));

  // Live-track fullscreen so the update-quit path can read the current state.
  mainWindow.on("enter-full-screen", () => saveFullScreenState(true));
  mainWindow.on("leave-full-screen", () => saveFullScreenState(false));

  container
    .get<ElectronMainWindow>(MAIN_WINDOW_SERVICE)
    .setMainWindowGetter(() => mainWindow);

  createIPCHandler({
    router: trpcRouter,
    windows: [mainWindow],
    createContext: async () => ({ container }),
    // Input is deliberately not logged — it can carry tokens or file contents.
    onError: ({ error, path, type }) => {
      trpcLog.error(`${type} '${path ?? "<unknown>"}' failed (${error.code})`, {
        message: error.message,
        cause: error.cause instanceof Error ? error.cause.stack : error.cause,
      });
    },
  });

  setupExternalLinkHandlers(mainWindow);
  setupWebviewHandlers(mainWindow);
  setupEditableContextMenu(mainWindow);
  setupCrashLogging(mainWindow);
  buildApplicationMenu();

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.on("closed", () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    mainWindow = null;
  });
}
