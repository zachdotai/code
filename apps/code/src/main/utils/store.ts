import Store from "electron-store";
import { getUserDataDir } from "./env";

/** Structurally matches Electron's Rectangle (not imported here — utils stay electron-free). */
export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  fullScreenDisplayBounds: DisplayBounds | undefined;
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
    fullScreenDisplayBounds: undefined,
    restoreFullScreenOnNextLaunch: false,
  },
});

export function saveZoomLevel(level: number): void {
  windowStateStore.set("zoomLevel", level);
}

export function saveFullScreenState(isFullScreen: boolean): void {
  windowStateStore.set("isFullScreen", isFullScreen);
}

export function getFullScreenState(): boolean {
  return windowStateStore.get("isFullScreen", false);
}

/**
 * The bounds of the display the window was last fullscreened on, so the
 * post-update relaunch can restore fullscreen on the same monitor.
 */
export function saveFullScreenDisplayBounds(bounds: DisplayBounds): void {
  windowStateStore.set("fullScreenDisplayBounds", bounds);
}

export function getFullScreenDisplayBounds(): DisplayBounds | undefined {
  return windowStateStore.get("fullScreenDisplayBounds", undefined);
}

/**
 * Set only when the app quits to install an update, so a fullscreen session
 * is restored after the "restart to apply" handoff.
 * A normal quit leaves it false and launches windowed.
 */
export function setRestoreFullScreenOnNextLaunch(restore: boolean): void {
  windowStateStore.set("restoreFullScreenOnNextLaunch", restore);
}

export function getRestoreFullScreenOnNextLaunch(): boolean {
  return windowStateStore.get("restoreFullScreenOnNextLaunch", false);
}
