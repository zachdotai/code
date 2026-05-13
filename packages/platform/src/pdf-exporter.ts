export interface PdfPageMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type PdfPageSize = "Letter" | "A4" | "Legal" | "Tabloid";

export interface PdfExportRequest {
  /** Full HTML document to render in an isolated offscreen window. */
  srcDoc: string;
  /**
   * Suggested filename for the save dialog (without extension). The adapter
   * appends ".pdf" and shows a native save dialog before doing any work.
   */
  suggestedFilename: string;
  /**
   * Width/height in CSS pixels for the offscreen render window. Use the
   * printable area of the target page so responsive content lays out at the
   * width it will be captured at.
   */
  windowSize: { width: number; height: number };
  /** postMessage `kind` value that signals the document is ready to print. */
  readyKind: string;
  /** postMessage `kind` value that signals a fatal load/render error. */
  errorKind: string;
  /**
   * Regex source. postMessages of `errorKind` whose `message` matches this
   * pattern are treated as loading-status updates, not failures. Useful for
   * loaders that incorrectly use the error channel for progress.
   */
  statusPattern: string;
  /** How long to wait for the ready signal before giving up. */
  readyTimeoutMs: number;
  /**
   * Extra delay after the ready signal before capturing, to allow libraries
   * like Chart.js (which animate via requestAnimationFrame) to settle.
   */
  settleMs: number;
  pageSize: PdfPageSize;
  margins: PdfPageMargins;
}

export type PdfExportResult =
  | { path: string; cancelled: false }
  | { path: null; cancelled: true };

export interface IPdfExporter {
  exportToPdf(request: PdfExportRequest): Promise<PdfExportResult>;
}
