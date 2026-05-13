import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  IPdfExporter,
  PdfExportRequest,
  PdfExportResult,
} from "@posthog/platform/pdf-exporter";
import { app, BrowserWindow, dialog } from "electron";
import { injectable } from "inversify";
import { logger } from "../utils/logger";

const log = logger.scope("electron-pdf-exporter");

const POLL_INTERVAL_MS = 200;

interface CanvasState {
  ready: boolean;
  error: string | null;
  lastStatus: string | null;
}

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[\\/:*?"<>|]/g, "-");
  return trimmed.length > 0 ? trimmed : "export";
}

function buildInstallScript(req: PdfExportRequest): string {
  // Pre-installs a postMessage listener so we don't miss the ready signal
  // even if the document posts it before we get a chance to attach.
  return `
(function() {
  window.__pdfExportState = { ready: false, error: null, lastStatus: null };
  const STATUS_RE = new RegExp(${JSON.stringify(req.statusPattern)});
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.kind === ${JSON.stringify(req.readyKind)}) {
      window.__pdfExportState.ready = true;
      return;
    }
    if (d.kind === ${JSON.stringify(req.errorKind)}) {
      const msg = typeof d.message === 'string' ? d.message : '';
      if (STATUS_RE.test(msg)) {
        window.__pdfExportState.lastStatus = msg;
      } else {
        window.__pdfExportState.error = msg;
      }
    }
  });
  true;
})();
`;
}

@injectable()
export class ElectronPdfExporter implements IPdfExporter {
  async exportToPdf(req: PdfExportRequest): Promise<PdfExportResult> {
    const parent =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!parent) {
      throw new Error("No window available for PDF export");
    }

    const filename = `${sanitizeFilename(req.suggestedFilename)}.pdf`;
    const defaultPath = join(app.getPath("downloads"), filename);

    const saveResult = await dialog.showSaveDialog(parent, {
      title: "Export as PDF",
      defaultPath,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { path: null, cancelled: true };
    }

    const offscreen = new BrowserWindow({
      show: false,
      width: req.windowSize.width,
      height: req.windowSize.height,
      backgroundColor: "#ffffff",
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    try {
      const dataUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(
        req.srcDoc,
        "utf8",
      ).toString("base64")}`;
      await offscreen.loadURL(dataUrl);

      await offscreen.webContents.executeJavaScript(buildInstallScript(req));

      await this.waitForReady(offscreen, req);

      // Let async libraries (Chart.js, etc.) settle at the window size.
      await new Promise((r) => setTimeout(r, req.settleMs));

      const buffer = await offscreen.webContents.printToPDF({
        printBackground: true,
        pageSize: req.pageSize,
        margins: req.margins,
      });

      await writeFile(saveResult.filePath, buffer);
      log.info("exported PDF", { path: saveResult.filePath });

      return { path: saveResult.filePath, cancelled: false };
    } finally {
      if (!offscreen.isDestroyed()) {
        offscreen.destroy();
      }
    }
  }

  private async waitForReady(
    win: BrowserWindow,
    req: PdfExportRequest,
  ): Promise<void> {
    const deadline = Date.now() + req.readyTimeoutMs;
    let lastStatus: string | null = null;
    while (Date.now() < deadline) {
      const state = (await win.webContents.executeJavaScript(
        "window.__pdfExportState",
      )) as CanvasState | undefined;
      if (state?.error) {
        throw new Error(`PDF export error: ${state.error}`);
      }
      if (state?.ready) {
        return;
      }
      if (state?.lastStatus && state.lastStatus !== lastStatus) {
        lastStatus = state.lastStatus;
        log.info("loading", { status: lastStatus });
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(
      `Document did not become ready within ${req.readyTimeoutMs / 1000}s` +
        (lastStatus ? ` (last status: ${lastStatus})` : ""),
    );
  }
}
