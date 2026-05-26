import { existsSync } from "node:fs";
import path from "node:path";
import type { ITray } from "@posthog/platform/tray";
import { app, nativeImage, Tray } from "electron";
import { injectable } from "inversify";

// Electron expects tray icons at 16×16 (32×32 for retina). Source PNGs are
// 1024×1024 so they must be resized before handing to Tray, otherwise the icon
// overflows the menu bar.
const TRAY_ICON_SIZE = 16;

@injectable()
export class ElectronTray implements ITray {
  private tray: Tray | null = null;
  private clickHandler: (() => void) | null = null;
  private readonly imageCache = new Map<string, Electron.NativeImage>();

  public isSupported(): boolean {
    return true;
  }

  public show(): void {
    if (this.tray) return;

    const baseImage = this.loadImage(this.resolveBadgePath(0));
    this.tray = new Tray(baseImage);
    this.tray.on("click", () => this.clickHandler?.());
    if (process.platform === "darwin") {
      this.tray.on("right-click", () => this.clickHandler?.());
    }
  }

  public hide(): void {
    if (!this.tray) return;
    this.tray.destroy();
    this.tray = null;
    this.imageCache.clear();
  }

  public setBadgeCount(count: number): void {
    if (!this.tray) return;

    if (process.platform === "darwin") {
      this.tray.setTitle(count > 0 ? String(count) : "");
      return;
    }

    const iconPath = this.resolveBadgePath(count);
    this.tray.setImage(this.loadImage(iconPath));
  }

  public setTooltip(text: string): void {
    this.tray?.setToolTip(text);
  }

  public onClick(handler: () => void): void {
    this.clickHandler = handler;
  }

  private resolveBadgePath(count: number): string {
    const bucket =
      count <= 0 ? "0" : count >= 10 ? "9plus" : String(Math.floor(count));
    const dir = this.trayAssetDir();
    const candidate = path.join(dir, `badge-${bucket}.png`);
    if (existsSync(candidate)) return candidate;

    // Fall back to the base app icon until designed badge overlays land.
    const base = path.join(dir, "badge-0.png");
    if (existsSync(base)) return base;

    return this.appIconFallback();
  }

  private trayAssetDir(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "tray");
    }
    return path.join(app.getAppPath(), "build", "tray");
  }

  private appIconFallback(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "app-icon.png");
    }
    return path.join(app.getAppPath(), "build", "app-icon.png");
  }

  private loadImage(filePath: string): Electron.NativeImage {
    const cached = this.imageCache.get(filePath);
    if (cached) return cached;
    // The brand icon is full-color and opaque, so leave templateImage off —
    // marking it template would render the silhouette as a solid block.
    const resized = nativeImage
      .createFromPath(filePath)
      .resize({ height: TRAY_ICON_SIZE, quality: "best" });
    this.imageCache.set(filePath, resized);
    return resized;
  }
}
