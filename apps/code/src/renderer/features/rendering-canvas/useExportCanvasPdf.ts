import { buildCanvasSrcDoc } from "@features/rendering-canvas/runtime";
import { useTRPC } from "@renderer/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { logger } from "@utils/logger";
import { toast } from "@utils/toast";
import { useCallback } from "react";

const log = logger.scope("export-canvas-pdf");

export function useExportCanvasPdf() {
  const trpcReact = useTRPC();
  const mutation = useMutation(
    trpcReact.canvasExport.exportPdf.mutationOptions(),
  );

  const exportPdf = useCallback(
    async ({ name, content }: { name: string; content: string }) => {
      log.info("exporting canvas to PDF", { name });
      try {
        const srcDoc = buildCanvasSrcDoc(content);
        const result = await mutation.mutateAsync({ name, srcDoc });
        if (result.cancelled) {
          return;
        }
        toast.success("Canvas exported", { description: result.path });
      } catch (err) {
        log.error("failed to export canvas", err);
        toast.error("Could not export canvas", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [mutation],
  );

  return { exportPdf, isExporting: mutation.isPending };
}
