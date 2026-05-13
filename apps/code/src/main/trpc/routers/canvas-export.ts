import { z } from "zod";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import type { CanvasExportService } from "../../services/canvas-export/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<CanvasExportService>(MAIN_TOKENS.CanvasExportService);

const exportPdfInput = z.object({
  name: z.string(),
  srcDoc: z.string(),
});

const exportPdfOutput = z.union([
  z.object({ path: z.string(), cancelled: z.literal(false) }),
  z.object({ path: z.null(), cancelled: z.literal(true) }),
]);

export const canvasExportRouter = router({
  exportPdf: publicProcedure
    .input(exportPdfInput)
    .output(exportPdfOutput)
    .mutation(({ input }) => getService().exportPdf(input)),
});
