import type {
  IPdfExporter,
  PdfExportResult,
} from "@posthog/platform/pdf-exporter";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";

// Letter at 96dpi is 816x1056 CSS px. Use the printable area (after 0.5in
// margins all sides) as the offscreen window size so responsive content
// like Chart.js renders at the width it ends up being captured at.
const LETTER_PRINTABLE_WIDTH_PX = 720;
const LETTER_PRINTABLE_HEIGHT_PX = 960;
const READY_TIMEOUT_MS = 30_000;
// Chart.js default animation is ~1s; give it a beat after ready before capture.
const SETTLE_MS = 1500;

// The canvas runtime (features/rendering-canvas/runtime.ts) overloads
// "canvas:error" for loading-progress updates ("Loading dependencies…",
// "Loaded react, loading react-dom…", etc). Treat anything matching this
// pattern as status, not a fatal error.
const CANVAS_STATUS_PATTERN = "^(Loading|Loaded|Dependencies)";

@injectable()
export class CanvasExportService {
  constructor(
    @inject(MAIN_TOKENS.PdfExporter) private readonly pdfExporter: IPdfExporter,
  ) {}

  async exportPdf({
    name,
    srcDoc,
  }: {
    name: string;
    srcDoc: string;
  }): Promise<PdfExportResult> {
    return this.pdfExporter.exportToPdf({
      srcDoc,
      suggestedFilename: name,
      windowSize: {
        width: LETTER_PRINTABLE_WIDTH_PX,
        height: LETTER_PRINTABLE_HEIGHT_PX,
      },
      readyKind: "canvas:ready",
      errorKind: "canvas:error",
      statusPattern: CANVAS_STATUS_PATTERN,
      readyTimeoutMs: READY_TIMEOUT_MS,
      settleMs: SETTLE_MS,
      pageSize: "Letter",
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
    });
  }
}
