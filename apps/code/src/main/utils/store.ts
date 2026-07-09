import Store from "electron-store";
import { getUserDataDir } from "./env";
import { logger } from "./logger";

const log = logger.scope("store");

interface FocusSession {
  mainRepoPath: string;
  worktreePath: string;
  branch: string;
  originalBranch: string;
  mainStashRef: string | null;
  commitSha: string;
}

interface FocusStoreSchema {
  sessions: Record<string, FocusSession>;
}

interface RendererStoreSchema {
  [key: string]: string;
}

export interface WindowStateSchema {
  x: number | undefined;
  y: number | undefined;
  width: number;
  height: number;
  isMaximized: boolean;
  zoomLevel: number;
  isFullScreen: boolean;
  restoreFullScreenOnNextLaunch: boolean;
}

const userDataDir = getUserDataDir();

export const rendererStore = new Store<RendererStoreSchema>({
  name: "renderer-storage",
  cwd: userDataDir,
});

export const focusStore = new Store<FocusStoreSchema>({
  name: "focus",
  cwd: userDataDir,
  defaults: { sessions: {} },
});

export type { FocusSession };

export const windowStateStore = new Store<WindowStateSchema>({
  name: "window-state",
  cwd: userDataDir,
  defaults: {
    x: undefined,
    y: undefined,
    width: 1200,
    height: 600,
    isMaximized: true,
    zoomLevel: 0,
    isFullScreen: false,
    restoreFullScreenOnNextLaunch: false,
  },
});

/**
 * Persist a single window-state key. Writes go through electron-store's
 * synchronous atomic `writeFileSync`, which can throw on transient FS errors
 * (e.g. `ENOSPC` when the disk is full). Window-state persistence is
 * non-critical, so a failed write is logged and swallowed rather than allowed
 * to propagate and crash the main process.
 */
export function setWindowStateKey<K extends keyof WindowStateSchema>(
  key: K,
  value: WindowStateSchema[K],
): void {
  try {
    windowStateStore.set(key, value);
  } catch (error) {
    log.warn(`Failed to persist window-state key "${key}"`, { error });
  }
}

export function saveZoomLevel(level: number): void {
  setWindowStateKey("zoomLevel", level);
}

export function saveFullScreenState(isFullScreen: boolean): void {
  setWindowStateKey("isFullScreen", isFullScreen);
}

export function getFullScreenState(): boolean {
  return windowStateStore.get("isFullScreen", false);
}

/**
 * Set only when the app quits to install an update, so a fullscreen session
 * is restored after the "restart to apply" handoff.
 * A normal quit leaves it false and launches windowed.
 */
export function setRestoreFullScreenOnNextLaunch(restore: boolean): void {
  setWindowStateKey("restoreFullScreenOnNextLaunch", restore);
}

export function getRestoreFullScreenOnNextLaunch(): boolean {
  return windowStateStore.get("restoreFullScreenOnNextLaunch", false);
}
