import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, globalShortcut, Menu, screen } from "electron";
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
const QUICK_ENTRY_MIN_SIDE_MARGIN = 32;
// Gap between the panel (window bottom) and the bottom of the work area.
const QUICK_ENTRY_BOTTOM_MARGIN = 96;
// The window hugs the glass panel exactly — native vibrancy fills the whole
// window rect, so any window area beyond the panel would show raw material.
// The renderer measures the panel and reports its height (plus popover
// headroom while a menu is open) via setQuickEntryContentHeight.
const QUICK_ENTRY_MIN_HEIGHT = 96;
const QUICK_ENTRY_MAX_HEIGHT = 640;
const QUICK_ENTRY_DEFAULT_HEIGHT = 168;

let quickEntryWindow: BrowserWindow | null = null;
let registeredAccelerator: string | null = null;
let contentHeight = QUICK_ENTRY_DEFAULT_HEIGHT;

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
    height: contentHeight,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // The window IS the panel, so the OS shadow and rounded corner mask apply
    // to the right shape. NOT `transparent: true` — transparent windows can't
    // be rounded and fight the vibrancy view; the alpha backgroundColor plus
    // vibrancy material is what makes the page's transparent pixels glassy.
    hasShadow: true,
    roundedCorners: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    ...(process.platform === "darwin"
      ? { vibrancy: "hud" as const, visualEffectState: "active" as const }
      : { transparent: true }),
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
  const height = Math.min(contentHeight, dh - QUICK_ENTRY_BOTTOM_MARGIN);
  const x = Math.round(dx + (dw - width) / 2);
  const y = Math.round(dy + dh - height - QUICK_ENTRY_BOTTOM_MARGIN);
  setWindowBounds(window, { x, y, width, height });

  window.show();
  window.focus();
  app.focus({ steal: true });
  return true;
}

// resizable:false blocks programmatic setBounds on macOS; lift it briefly.
function setWindowBounds(
  window: BrowserWindow,
  bounds: { x: number; y: number; width: number; height: number },
): void {
  window.setResizable(true);
  window.setBounds(bounds, false);
  window.setResizable(false);
}

/**
 * Renderer-reported window height: panel height, plus headroom while a
 * popover is open. The bottom edge stays anchored so the panel doesn't move.
 */
export function setQuickEntryContentHeight(height: number): void {
  const next = Math.max(
    QUICK_ENTRY_MIN_HEIGHT,
    Math.min(QUICK_ENTRY_MAX_HEIGHT, Math.round(height)),
  );
  contentHeight = next;
  const window = quickEntryWindow;
  if (!window || window.isDestroyed()) return;
  const bounds = window.getBounds();
  if (bounds.height === next) return;
  const bottom = bounds.y + bounds.height;
  setWindowBounds(window, {
    x: bounds.x,
    y: bottom - next,
    width: bounds.width,
    height: next,
  });
}

export interface NativeMenuItemSpec {
  type?: "item" | "separator" | "header";
  id?: string;
  label?: string;
  checked?: boolean;
  enabled?: boolean;
}

/**
 * Pickers use native NSMenus: they float outside the window, so the
 * panel-hugging vibrancy window never has to grow to host a popover (any
 * growth paints a slab of raw material). Resolves with the clicked item id,
 * or null when dismissed. x/y are window-content coordinates.
 */
export function showQuickEntryNativeMenu(spec: {
  items: NativeMenuItemSpec[];
  x: number;
  y: number;
}): Promise<string | null> {
  const window = quickEntryWindow;
  if (!window || window.isDestroyed()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let selected: string | null = null;
    const menu = Menu.buildFromTemplate(
      spec.items.map((item) => {
        if (item.type === "separator") return { type: "separator" as const };
        if (item.type === "header") {
          return { label: item.label ?? "", enabled: false };
        }
        return {
          label: item.label ?? "",
          type:
            item.checked !== undefined
              ? ("checkbox" as const)
              : ("normal" as const),
          checked: item.checked,
          enabled: item.enabled !== false,
          click: () => {
            selected = item.id ?? null;
          },
        };
      }),
    );
    menu.popup({
      window,
      x: Math.round(spec.x),
      y: Math.round(spec.y),
      callback: () => resolve(selected),
    });
  });
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
