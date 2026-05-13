import { CanvasRenderer } from "@features/rendering-canvas/CanvasRenderer";
import TEST_CANVAS from "@features/rendering-canvas/test-canvas-stub.tsx?raw";
import { SparkleIcon } from "@phosphor-icons/react";
import { Dialog } from "@radix-ui/themes";
import { useState } from "react";

export function TestCanvasButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          <span>Test canvas</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Content
        maxWidth="720px"
        style={{ height: 520, padding: 0, overflow: "hidden" }}
      >
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {error && (
            <div className="whitespace-pre-wrap bg-(--red-3) px-3 py-2 font-mono text-(--red-11) text-xs">
              {error}
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0 }}>
            <CanvasRenderer
              content={TEST_CANVAS}
              onReady={() => setError(null)}
              onError={setError}
              onApiCall={async (path) => {
                throw new Error(
                  `Test canvas has no API resolver (called "${path}")`,
                );
              }}
            />
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
