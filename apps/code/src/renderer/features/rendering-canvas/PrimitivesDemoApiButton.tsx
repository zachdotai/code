import { useAuthenticatedClient } from "@features/auth/hooks/authClient";
import { CanvasRenderer } from "@features/rendering-canvas/CanvasRenderer";
import PRIMITIVES_DEMO_CANVAS from "@features/rendering-canvas/primitives-demo-canvas-stub.tsx?raw";
import { useExportCanvasPdf } from "@features/rendering-canvas/useExportCanvasPdf";
import { FilePdf, SparkleIcon } from "@phosphor-icons/react";
import { Button, Dialog, Flex } from "@radix-ui/themes";
import type { PostHogAPIClient } from "@renderer/api/posthogClient";
import { useMemo, useState } from "react";

// Stub-path button: bypasses the REST API (the rendering-canvases endpoint
// 404s until the Django ViewSet is deployed) and feeds the demo TSX straight
// into <CanvasRenderer>. Useful for visually validating the runtime primitives
// (PageHeader, Kpi, Section, chartTheme, …) without needing the backend.

const CANVAS_NAME = "Primitives demo";

function buildClientResolver(client: PostHogAPIClient) {
  return async (path: string, args: unknown[]) => {
    const segments = path.split(".");
    let target: unknown = client;
    for (const segment of segments) {
      if (target == null || typeof target !== "object") {
        throw new Error(`"${path}" is not callable on the client`);
      }
      target = (target as Record<string, unknown>)[segment];
    }
    if (typeof target !== "function") {
      throw new Error(`"${path}" is not a function on the client`);
    }
    return await (target as (...a: unknown[]) => unknown).apply(client, args);
  };
}

export function PrimitivesDemoApiButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useAuthenticatedClient();
  const resolver = useMemo(() => buildClientResolver(client), [client]);
  const { exportPdf, isExporting } = useExportCanvasPdf();

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <button
          type="button"
          className="flex w-full items-center gap-1 bg-transparent px-2 py-1.5 text-left text-(--gray-11) text-[13px] transition-colors hover:bg-(--gray-3)"
        >
          <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center text-(--gray-10)">
            <SparkleIcon size={14} />
          </span>
          <span>{CANVAS_NAME}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Content
        maxWidth="720px"
        style={{ height: 560, padding: 0, overflow: "hidden" }}
      >
        <Flex direction="column" className="h-full w-full">
          <Flex
            align="center"
            justify="between"
            className="shrink-0 border-(--gray-5) border-b px-3 py-2"
          >
            <Dialog.Title className="m-0 text-(--gray-12) text-sm">
              {CANVAS_NAME}
            </Dialog.Title>
            <Button
              size="1"
              variant="soft"
              onClick={() => exportPdf({ name: CANVAS_NAME })}
              disabled={isExporting}
              aria-label="Export canvas as PDF"
            >
              <FilePdf weight="regular" />
              {isExporting ? "Exporting…" : "Export PDF"}
            </Button>
          </Flex>
          {error && (
            <div className="shrink-0 whitespace-pre-wrap bg-(--red-3) px-3 py-2 font-mono text-(--red-11) text-xs">
              {error}
            </div>
          )}
          <Flex direction="column" className="min-h-0 flex-1">
            <CanvasRenderer
              content={PRIMITIVES_DEMO_CANVAS}
              onReady={() => setError(null)}
              onError={setError}
              onApiCall={resolver}
            />
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
