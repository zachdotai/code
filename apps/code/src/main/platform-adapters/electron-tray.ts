import { existsSync } from "node:fs";
import path from "node:path";
import type { ITray } from "@posthog/platform/tray";
import { app, nativeImage, Tray } from "electron";
import { injectable } from "inversify";

// macOS renders tray icons in points, and Electron auto-discovers @2x/@3x
// variants. The template PNGs are pre-rendered at 22/44/66 px, so on macOS we
// don't resize. Windows/Linux trays render around 16px and use the colored
// badge-N.png set, which are resized down from the 1024×1024 brand icon.
const NON_MAC_TRAY_ICON_SIZE = 16;

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
    const dir = this.trayAssetDir();

    if (process.platform === "darwin") {
      // Monochrome silhouette that adapts to light/dark menu bar. The macOS
      // count is rendered via setTitle, so a single template suffices.
      const template = path.join(dir, "icon.template.png");
      if (existsSync(template)) return template;
    }

    const bucket =
      count <= 0 ? "0" : count >= 10 ? "9plus" : String(Math.floor(count));
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

    const isMacTemplate =
      process.platform === "darwin" && filePath.endsWith(".template.png");
    let image = nativeImage.createFromPath(filePath);
    if (!isMacTemplate) {
      image = image.resize({
        height: NON_MAC_TRAY_ICON_SIZE,
        quality: "best",
      });
    }
    if (isMacTemplate) image.setTemplateImage(true);
    this.imageCache.set(filePath, image);
    return image;
  }
}
