import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

// Letter at 96dpi is 816x1056 CSS px. Use the printable area (after 0.5in
// margins) as the offscreen render width so the snapshot lays out at the
// width it will be printed at, with text reflowing naturally.
const OFFSCREEN_WIDTH_PX = 720;
const OFFSCREEN_HEIGHT_PX = 960;
// Brief settle so any in-flight Chart.js rAF animation finalizes before we
// read canvas pixel data. User has been looking at the canvas, so this is
// the only timing we control.
const PRE_SNAPSHOT_SETTLE_MS = 500;
// Time for the offscreen wrapper to load the snapshot HTML and lay out
// before we call printToPDF.
const OFFSCREEN_SETTLE_MS = 350;

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[\\/:*?"<>|]/g, "-");
  return trimmed.length > 0 ? trimmed : "export";
}

// Runs inside the iframe's sandboxed frame. Clones the entire document,
// rasterizes every <canvas> (Chart.js, etc.) into an <img> at its current
// display dimensions, strips scripts so they don't re-bootstrap when the
// snapshot loads in the offscreen window, and returns the resulting
// outerHTML. The original iframe is untouched.
const SNAPSHOT_SCRIPT = String.raw`
(() => {
  const orig = document.documentElement;
  const clone = orig.cloneNode(true);
  const origCanvases = orig.querySelectorAll('canvas');
  const cloneCanvases = clone.querySelectorAll('canvas');
  for (let i = 0; i < origCanvases.length; i++) {
    const c = origCanvases[i];
    const target = cloneCanvases[i];
    if (!c || !target) continue;
    try {
      const rect = c.getBoundingClientRect();
      const dataUrl = c.toDataURL('image/png');
      const img = document.createElement('img');
      img.src = dataUrl;
      // max-width keeps the chart inside narrower print areas; aspect ratio
      // is preserved by the PNG's intrinsic dimensions.
      img.style.cssText =
        'display:block;max-width:100%;width:' + Math.ceil(rect.width) + 'px;height:auto;';
      target.replaceWith(img);
    } catch (err) {
      // Tainted canvas (cross-origin pixels) — rare for our self-rendered
      // Chart.js content. Leave the empty <canvas> in place.
    }
  }
  // Strip scripts (including importmap) so the snapshot doesn't try to
  // re-bootstrap React / Chart.js / Babel when it loads offscreen.
  clone.querySelectorAll('script').forEach((s) => s.remove());
  // Drop the runtime's CSP meta — we already removed scripts and we load
  // from a temp file so the runtime CSP just gets in our way now.
  clone
    .querySelectorAll('meta[http-equiv="Content-Security-Policy"]')
    .forEach((m) => m.remove());
  // Print-friendly defaults + page-break hints. We can't know the canvas's
  // exact card class names, so we hit common patterns.
  const style = document.createElement('style');
  style.textContent =
    'html, body { background: white !important; margin: 0; padding: 0; }' +
    /* Honor break-inside on common card-ish patterns. Browsers ignore the
       rule when an element is taller than a page, so it can only help. */
    '[class*="card" i], [class*="section" i], [class*="panel" i],' +
    '[class*="kpi" i], [class*="metric" i], [data-card],' +
    'section, article, fieldset, figure {' +
    '  break-inside: avoid;' +
    '  page-break-inside: avoid;' +
    '}' +
    'img { break-inside: avoid; page-break-inside: avoid; }';
  const head = clone.querySelector('head');
  if (head) head.appendChild(style);
  return '<!doctype html>' + clone.outerHTML;
})()
`;

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

    // Find the canvas iframe's sub-frame. Filter by URL pattern so we
    // don't grab devtools / analytics / other iframes that may exist.
    const isCanvasFrame = (f: Electron.WebFrameMain) =>
      f !== parent.webContents.mainFrame &&
      (f.url === "about:srcdoc" || f.url.startsWith("data:"));
    const iframeFrame =
      parent.webContents.mainFrame.framesInSubtree.find(isCanvasFrame);
    if (!iframeFrame) {
      throw new Error("Canvas iframe frame not found in parent webContents");
    }

    // Let any in-flight Chart.js animation finalize before we sample
    // <canvas> pixels.
    await new Promise((r) => setTimeout(r, PRE_SNAPSHOT_SETTLE_MS));

    const snapshotHtml = (await iframeFrame.executeJavaScript(
      SNAPSHOT_SCRIPT,
    )) as string;
    log.info("snapshotted canvas DOM", { bytes: snapshotHtml.length });

    // Write to a temp file rather than a data: URL — snapshots with many
    // chart PNGs can easily exceed reasonable data-URL sizes.
    const tmpPath = join(tmpdir(), `posthog-canvas-pdf-${Date.now()}.html`);
    await writeFile(tmpPath, snapshotHtml, "utf8");

    const offscreen = new BrowserWindow({
      show: false,
      width: OFFSCREEN_WIDTH_PX,
      height: OFFSCREEN_HEIGHT_PX,
      backgroundColor: "#ffffff",
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    try {
      await offscreen.loadFile(tmpPath);
      await new Promise((r) => setTimeout(r, OFFSCREEN_SETTLE_MS));

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
      await unlink(tmpPath).catch(() => {
        /* best-effort cleanup */
      });
    }
  }
}
