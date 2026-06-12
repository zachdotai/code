import type { IAppLifecycle } from "@posthog/platform/app-lifecycle";
import { app } from "electron";
import { injectable } from "inversify";

@injectable()
export class ElectronAppLifecycle implements IAppLifecycle {
  public whenReady(): Promise<void> {
    return app.whenReady().then(() => undefined);
  }

  public quit(): void {
    app.quit();
  }

  public exit(code?: number): void {
    app.exit(code);
  }

  public onQuit(handler: () => void | Promise<void>): () => void {
    const listener = (event: Electron.Event) => {
      const result = handler();
      if (result instanceof Promise) {
        event.preventDefault();
        result.finally(() => app.quit());
      }
    };
    app.on("before-quit", listener);
    return () => app.off("before-quit", listener);
  }

  public registerDeepLinkScheme(scheme: string): void {
    // NOTE: setAsDefaultProtocolClient's optional `path`/`args` are Windows-only
    // and ignored on Linux/macOS. On Linux, registration relies on the packaged
    // .desktop file declaring `MimeType=x-scheme-handler/<scheme>` so desktop
    // integration can route the scheme — see forge.config.ts (the AppImage,
    // deb, and rpm makers all set `mimeType`). Passing an AppImage exec path
    // here would be a no-op, so it is intentionally omitted.
    app.setAsDefaultProtocolClient(scheme);
  }
}
